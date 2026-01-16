// LunaTV Go Proxy Server
// Replaces Next.js API proxy routes with high-performance Go implementation.
// Neutron Star Release (Patched): Singleflight Parity Fix + Future-Proof TLS + Diamond-Hard Security.
//
// Final Architecture:
// 1. Correctness: Bypasses Singleflight for conditional requests on cache miss.
// 2. SSRF: Connect-Time Verification (DNS Rebinding Proof).
// 3. Transport: HTTP/2 ALPN enforced + SNI Preservation + Load Balancing.
// 4. Resilience: Context Propagation + Jittered Retry.
// 5. ✅ Patch: Ensure X-Cache cannot be overwritten by upstream headers (set after header cloning).

package main

import (
	"bytes"
	"container/list"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/signal"
	"path"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ===== Configuration =====

type LiveSource struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	URL  string `json:"url"`
	UA   string `json:"ua"`
}

type SiteConfig struct {
	DoubanImageProxyType string `json:"DoubanImageProxyType"`
	DoubanImageProxy     string `json:"DoubanImageProxy"`
	ImageCacheTTL        int    `json:"ImageCacheTTL"`
}

type Config struct {
	LiveConfig []LiveSource `json:"LiveConfig"`
	SiteConfig SiteConfig   `json:"SiteConfig"`
}

var (
	config     Config
	configPath string
	client     *http.Client

	uriRegex = regexp.MustCompile(`URI="([^"]+)"`)

	hopByHopHeaders = map[string]bool{
		"Connection":          true,
		"Proxy-Connection":    true,
		"Keep-Alive":          true,
		"Proxy-Authenticate":  true,
		"Proxy-Authorization": true,
		"TE":                  true,
		"Trailer":             true,
		"Transfer-Encoding":   true,
		"Upgrade":             true,
	}

	skipHeaderPool = sync.Pool{
		New: func() interface{} { return make(map[string]bool) },
	}

	m3u8Tag = []byte("#EXTM3U")

	// Security: Private IP blocks for SSRF check
	privateIPBlocks []*net.IPNet
)

const DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// ===== Initialization & Security =====

func init() {
	rand.Seed(time.Now().UnixNano())

	// Initialize Private IP blocks
	for _, cidr := range []string{
		"0.0.0.0/8",      // "this" network
		"10.0.0.0/8",     // RFC1918
		"127.0.0.0/8",    // loopback
		"169.254.0.0/16", // link-local
		"172.16.0.0/12",  // RFC1918
		"192.168.0.0/16", // RFC1918
		"100.64.0.0/10",  // CGNAT
		"198.18.0.0/15",  // benchmark/testing
		"224.0.0.0/4",    // multicast
		"240.0.0.0/4",    // reserved
		"::/128",         // unspecified
		"::1/128",        // IPv6 loopback
		"fe80::/10",      // IPv6 link-local
		"fc00::/7",       // IPv6 unique local
		"ff00::/8",       // IPv6 multicast
	} {
		_, block, err := net.ParseCIDR(cidr)
		if err == nil {
			privateIPBlocks = append(privateIPBlocks, block)
		}
	}

	dialer := &net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	// Base TLS config (placeholder for future custom CAs)
	baseTLSConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	transport := &http.Transport{
		// ✅ HTTP: dial verified IP (TOCTOU-safe)
		DialContext: guardedDialContext(dialer),

		// ✅ HTTPS: dial verified IP, preserve SNI, enforce ALPN
		DialTLSContext: guardedDialTLSContext(dialer, baseTLSConfig),

		TLSClientConfig:       baseTLSConfig,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    true,
		ForceAttemptHTTP2:     true,
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatalf("Failed to create cookie jar: %v", err)
	}

	client = &http.Client{
		Transport: transport,
		Timeout:   60 * time.Second,
		Jar:       jar,
	}
}

// isPrivateIP checks explicit blocklists
func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	for _, block := range privateIPBlocks {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

// isSafePublicIP enforces "global unicast only" + explicit blocklists
func isSafePublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	ip = ip.To16()
	if ip == nil {
		return false
	}
	if !ip.IsGlobalUnicast() {
		return false
	}
	if isPrivateIP(ip) {
		return false
	}
	return true
}

// resolveAndPickSafeIP resolves host and picks a RANDOM safe public IP (Load Balancing)
func resolveAndPickSafeIP(ctx context.Context, host string) (net.IP, error) {
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("ssrf blocked: no resolved ip")
	}

	safeIPs := make([]net.IP, 0, len(ips))
	for _, ipa := range ips {
		if !isSafePublicIP(ipa.IP) {
			// Strict mode: if one IP is private, block the whole hostname
			return nil, errors.New("ssrf blocked: hostname resolves to non-public ip")
		}
		safeIPs = append(safeIPs, ipa.IP)
	}

	if len(safeIPs) == 0 {
		return nil, errors.New("ssrf blocked: no usable ip")
	}

	// ✅ Load Balancing: Pick random IP from safe list
	return safeIPs[rand.Intn(len(safeIPs))], nil
}

// guardedDialContext (HTTP) dials the verified IP
func guardedDialContext(d *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}

		if ip := net.ParseIP(host); ip != nil {
			if !isSafePublicIP(ip) {
				return nil, errors.New("ssrf blocked: non-public ip")
			}
			return d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		}

		ip, err := resolveAndPickSafeIP(ctx, host)
		if err != nil {
			return nil, err
		}
		return d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
	}
}

// guardedDialTLSContext (HTTPS) dials verified IP, preserves SNI, and enables HTTP/2
func guardedDialTLSContext(d *net.Dialer, base *tls.Config) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}

		var ip net.IP
		if parsed := net.ParseIP(host); parsed != nil {
			if !isSafePublicIP(parsed) {
				return nil, errors.New("ssrf blocked: non-public ip")
			}
			ip = parsed
		} else {
			ip, err = resolveAndPickSafeIP(ctx, host)
			if err != nil {
				return nil, err
			}
		}

		rawConn, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err != nil {
			return nil, err
		}

		// ✅ Construct TLS Config using helper
		tlsConfig := buildTLSConfig(base, host)

		tlsConn := tls.Client(rawConn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			rawConn.Close()
			return nil, err
		}
		return tlsConn, nil
	}
}

// buildTLSConfig clones base config (if any), then enforces SNI + ALPN
func buildTLSConfig(base *tls.Config, serverName string) *tls.Config {
	var cfg *tls.Config
	if base != nil {
		cfg = base.Clone()
	} else {
		cfg = &tls.Config{}
	}

	cfg.ServerName = serverName

	// Enforce ALPN (keep existing if already set, ensure h2/http1.1 presence)
	if len(cfg.NextProtos) == 0 {
		cfg.NextProtos = []string{"h2", "http/1.1"}
	} else {
		hasH2, hasH11 := false, false
		for _, p := range cfg.NextProtos {
			if p == "h2" {
				hasH2 = true
			}
			if p == "http/1.1" {
				hasH11 = true
			}
		}
		if !hasH2 {
			cfg.NextProtos = append([]string{"h2"}, cfg.NextProtos...)
		}
		if !hasH11 {
			cfg.NextProtos = append(cfg.NextProtos, "http/1.1")
		}
	}
	return cfg
}

func validateTargetURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("invalid scheme")
	}
	if u.Hostname() == "" {
		return errors.New("missing hostname")
	}
	return nil
}

// ===== Cache Constants & Tuning =====

const (
	MaxCacheItems    = 1000
	MaxCacheBytes    = 512 * 1024 * 1024
	SegmentTTL       = 20 * time.Second
	InitSegmentTTL   = 5 * time.Minute
	MaxRetries       = 3
	MaxSegmentSize   = 20 * 1024 * 1024
	ReadLimit        = MaxSegmentSize + 1
	PlaylistPeekByte = 2048
)

// ===== LRU Cache =====

var cachedHeaderAllowlist = map[string]bool{
	"Content-Type":     true,
	"Cache-Control":    true,
	"Accept-Ranges":    true,
	"Content-Range":    true,
	"ETag":             true,
	"Last-Modified":    true,
	"Expires":          true,
	"Content-Encoding": true,
}

type CacheItem struct {
	Key       string
	Data      []byte
	Headers   http.Header
	SizeBytes int64
	ExpiresAt time.Time
}

type LRUCache struct {
	sync.Mutex
	capacity     int
	maxBytes     int64
	currentBytes int64
	items        map[string]*list.Element
	evictList    *list.List
}

func NewLRUCache(capacity int, maxBytes int64) *LRUCache {
	return &LRUCache{
		capacity:  capacity,
		maxBytes:  maxBytes,
		items:     make(map[string]*list.Element),
		evictList: list.New(),
	}
}

func (c *LRUCache) Get(key string) ([]byte, http.Header, bool) {
	c.Lock()
	defer c.Unlock()

	if ent, ok := c.items[key]; ok {
		item := ent.Value.(*CacheItem)
		if time.Now().After(item.ExpiresAt) {
			c.removeElement(ent)
			return nil, nil, false
		}
		c.evictList.MoveToFront(ent)
		return item.Data, item.Headers, true
	}
	return nil, nil, false
}

func (c *LRUCache) Set(key string, data []byte, headers http.Header, ttl time.Duration) {
	c.Lock()
	defer c.Unlock()

	headerCopy, headerBytes := filterAndCopyHeaders(headers)
	itemSize := int64(len(data)) + headerBytes

	if ent, ok := c.items[key]; ok {
		c.evictList.MoveToFront(ent)
		item := ent.Value.(*CacheItem)
		c.currentBytes -= item.SizeBytes
		item.Data = data
		item.Headers = headerCopy
		item.SizeBytes = itemSize
		item.ExpiresAt = time.Now().Add(ttl)
		c.currentBytes += itemSize
		c.evict()
		return
	}

	item := &CacheItem{
		Key:       key,
		Data:      data,
		Headers:   headerCopy,
		SizeBytes: itemSize,
		ExpiresAt: time.Now().Add(ttl),
	}
	ent := c.evictList.PushFront(item)
	c.items[key] = ent
	c.currentBytes += itemSize
	c.evict()
}

func (c *LRUCache) removeElement(e *list.Element) {
	c.evictList.Remove(e)
	kv := e.Value.(*CacheItem)
	delete(c.items, kv.Key)
	c.currentBytes -= kv.SizeBytes
}

func (c *LRUCache) evict() {
	for c.evictList.Len() > c.capacity {
		c.removeElement(c.evictList.Back())
	}
	for c.currentBytes > c.maxBytes && c.evictList.Len() > 0 {
		c.removeElement(c.evictList.Back())
	}
}

var globalSegmentCache = NewLRUCache(MaxCacheItems, MaxCacheBytes)

// ===== Singleflight =====

type call struct {
	wg      sync.WaitGroup
	val     []byte
	headers http.Header
	err     error
}

type Group struct {
	mu sync.Mutex
	m  map[string]*call
}

func (g *Group) Do(key string, fn func() ([]byte, http.Header, error)) ([]byte, http.Header, error) {
	g.mu.Lock()
	if g.m == nil {
		g.m = make(map[string]*call)
	}
	if c, ok := g.m[key]; ok {
		g.mu.Unlock()
		c.wg.Wait()
		return c.val, c.headers, c.err
	}
	c := new(call)
	c.wg.Add(1)
	g.m[key] = c
	g.mu.Unlock()

	c.val, c.headers, c.err = fn()
	c.wg.Done()

	g.mu.Lock()
	delete(g.m, key)
	g.mu.Unlock()

	return c.val, c.headers, c.err
}

var sfGroup Group

// ===== Helper Functions =====

func loadConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("Warning: Could not load config from %s: %v", path, err)
		return nil
	}
	return json.Unmarshal(data, &config)
}

func getUserAgentStrict(sourceKey string) (string, bool) {
	for _, src := range config.LiveConfig {
		if src.Key == sourceKey {
			if src.UA != "" {
				return src.UA, true
			}
			return DefaultUserAgent, true
		}
	}
	return DefaultUserAgent, false
}

func getUserAgent(sourceKey string) string {
	ua, _ := getUserAgentStrict(sourceKey)
	return ua
}

func forwardableHeaders(r *http.Request) map[string]string {
	h := make(map[string]string)
	keys := []string{
		"Range", "If-Range",
		"If-Match", "If-None-Match",
		"If-Modified-Since", "If-Unmodified-Since",
	}
	for _, k := range keys {
		if v := r.Header.Get(k); v != "" {
			h[k] = v
		}
	}
	return h
}

func copyHeaders(dst, src http.Header) {
	toSkip := skipHeaderPool.Get().(map[string]bool)
	for k := range toSkip {
		delete(toSkip, k)
	}

	for k := range hopByHopHeaders {
		toSkip[http.CanonicalHeaderKey(k)] = true
	}

	if conns := src["Connection"]; len(conns) > 0 {
		for _, c := range conns {
			for _, token := range strings.Split(c, ",") {
				token = strings.TrimSpace(token)
				if token != "" {
					toSkip[http.CanonicalHeaderKey(token)] = true
				}
			}
		}
	}

	for k, vv := range src {
		if toSkip[http.CanonicalHeaderKey(k)] {
			continue
		}
		dst[k] = append([]string(nil), vv...)
	}
	skipHeaderPool.Put(toSkip)
}

func filterAndCopyHeaders(src http.Header) (http.Header, int64) {
	out := make(http.Header)
	var size int64
	for k, vv := range src {
		ck := http.CanonicalHeaderKey(k)
		if !cachedHeaderAllowlist[ck] {
			continue
		}
		out[ck] = append([]string(nil), vv...)
		size += int64(len(ck))
		for _, v := range vv {
			size += int64(len(v))
		}
	}
	return out, size
}

func shouldReturn304FromCache(r *http.Request, cached http.Header) bool {
	if inm := r.Header.Get("If-None-Match"); inm != "" {
		etag := cached.Get("ETag")
		if etag == "" {
			return false
		}
		for _, part := range strings.Split(inm, ",") {
			p := strings.TrimSpace(part)
			if p == "*" || p == etag {
				return true
			}
		}
		return false
	}

	if ims := r.Header.Get("If-Modified-Since"); ims != "" {
		lm := cached.Get("Last-Modified")
		if lm == "" {
			return false
		}
		imsT, err1 := http.ParseTime(ims)
		lmT, err2 := http.ParseTime(lm)
		if err1 == nil && err2 == nil && !lmT.After(imsT) {
			return true
		}
	}
	return false
}

func hasStrongPreconditions(r *http.Request) bool {
	return r.Header.Get("If-Match") != "" ||
		r.Header.Get("If-Unmodified-Since") != ""
}

// ===== Fetch Logic =====

func fetchWithRetry(ctx context.Context, method, targetURL, userAgent string, headers map[string]string) (*http.Response, error) {
	var resp *http.Response
	var err error

	if method == "" {
		method = "GET"
	}

	for i := 0; i < MaxRetries; i++ {
		req, e := http.NewRequestWithContext(ctx, method, targetURL, nil)
		if e != nil {
			return nil, e
		}
		req.Header.Set("User-Agent", userAgent)
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err = client.Do(req)
		if err == nil {
			if resp.StatusCode < 500 && resp.StatusCode != 429 && resp.StatusCode != 408 {
				return resp, nil
			}
			resp.Body.Close()
		} else if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		baseDelay := 200 * (1 << i)
		jitter := rand.Intn(100)
		backoff := time.Duration(baseDelay+jitter) * time.Millisecond

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
	}
	return resp, err
}

// ===== Helper: HEAD proxy =====

func handleHeadProxy(w http.ResponseWriter, r *http.Request, targetURL, ua string, reqHeaders map[string]string) bool {
	if r.Method != http.MethodHead {
		return false
	}

	resp, err := fetchWithRetry(r.Context(), "HEAD", targetURL, ua, reqHeaders)
	if err != nil {
		http.Error(w, "HEAD fetch error", 502)
		return true
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)
	w.Header().Set("X-Cache", "BYPASS-HEAD")

	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.HasSuffix(strings.ToLower(targetURL), ".m3u8") || strings.Contains(ct, "mpegurl") {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Del("Content-Length")
	}

	w.WriteHeader(resp.StatusCode)
	return true
}

// ===== Handlers =====

func handleM3U8(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	targetURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		targetURL = rawURL
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target URL", 403)
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	allowCORS := r.URL.Query().Get("allowCORS") == "true"
	ua := getUserAgent(sourceKey)
	reqHeaders := forwardableHeaders(r)

	if handleHeadProxy(w, r, targetURL, ua, reqHeaders) {
		return
	}

	resp, err := fetchWithRetry(r.Context(), "GET", targetURL, ua, reqHeaders)
	if err != nil {
		log.Printf("M3U8 fetch error: %v", err)
		http.Error(w, "Failed to fetch m3u8", 502)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("Upstream error %d", resp.StatusCode), resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("M3U8 read body error: %v", err)
		http.Error(w, "Failed to read m3u8 body", 502)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	lowerCT := strings.ToLower(contentType)

	isM3U8 := false
	if strings.Contains(lowerCT, "mpegurl") {
		isM3U8 = true
	} else {
		peek := PlaylistPeekByte
		if len(body) < peek {
			peek = len(body)
		}
		if peek > 0 && bytes.Contains(body[:peek], m3u8Tag) {
			isM3U8 = true
		}
	}

	if isM3U8 {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)

		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Del("Content-Length")
		w.Header().Del("Content-Encoding")
		w.Header().Del("ETag")
		w.Header().Del("Last-Modified")
		w.Header().Del("Content-MD5")

		baseURL := getBaseURL(resp.Request.URL.String())

		scheme := "http"
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			scheme = "https"
		}
		host := r.Host
		if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
			host = fh
		}
		proxyBase := fmt.Sprintf("%s://%s/api/proxy", scheme, host)

		rewritten := rewriteM3U8(string(body), baseURL, proxyBase, sourceKey, allowCORS)

		w.WriteHeader(resp.StatusCode)
		w.Write([]byte(rewritten))
		return
	}

	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

func handleSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	targetURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		targetURL = rawURL
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target URL", 403)
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	ua := getUserAgent(sourceKey)
	reqHeaders := forwardableHeaders(r)

	if handleHeadProxy(w, r, targetURL, ua, reqHeaders) {
		return
	}

	if r.Header.Get("Range") != "" {
		handleRangeRequest(w, r, targetURL, ua)
		return
	}

	// Strong preconditions should bypass cache.
	if hasStrongPreconditions(r) {
		handlePassThrough(w, r, targetURL, sourceKey, "", 0)
		return
	}

	cacheKey := sourceKey + "|" + targetURL

	// 1) Cache hit
	if data, headers, ok := globalSegmentCache.Get(cacheKey); ok {
		if shouldReturn304FromCache(r, headers) {
			copyHeaders(w.Header(), headers)
			setCORSHeaders(w)
			w.Header().Set("X-Cache", "HIT-304")
			w.WriteHeader(http.StatusNotModified)
			return
		}

		copyHeaders(w.Header(), headers)
		setCORSHeaders(w)
		w.Header().Set("X-Cache", "HIT")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
		w.WriteHeader(200)
		w.Write(data)
		return
	}

	// ✅ Correctness: Cache miss + weak validators => bypass singleflight/cache
	// This ensures strict upstream answers (304 vs 200) and avoids cross-client validator mixing.
	if r.Header.Get("If-None-Match") != "" || r.Header.Get("If-Modified-Since") != "" {
		handlePassThrough(w, r, targetURL, sourceKey, "", 0)
		return
	}

	// 2) Cache miss + no validators => singleflight
	data, headers, err := sfGroup.Do(cacheKey, func() ([]byte, http.Header, error) {
		// ✅ Resilience: Use detached context so client disconnects don't kill the fetch for others (or cache population)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		resp, err := fetchWithRetry(ctx, "GET", targetURL, ua, nil)
		if err != nil {
			return nil, nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return nil, nil, fmt.Errorf("upstream status: %d", resp.StatusCode)
		}

		bodyData, err := io.ReadAll(io.LimitReader(resp.Body, int64(ReadLimit)))
		if err != nil {
			return nil, nil, err
		}
		if len(bodyData) > MaxSegmentSize {
			return nil, nil, fmt.Errorf("segment too large")
		}

		return bodyData, resp.Header, nil
	})

	if err != nil {
		if strings.Contains(err.Error(), "upstream status") {
			handlePassThrough(w, r, targetURL, sourceKey, "", 0)
			return
		}
		log.Printf("Segment fetch error: %v | URL: %s", err, targetURL)
		http.Error(w, "Failed to fetch segment", 502)
		return
	}

	shouldCache := true
	ct := headers.Get("Content-Type")
	lowerCT := strings.ToLower(ct)

	if strings.Contains(lowerCT, "text/html") ||
		strings.Contains(lowerCT, "application/json") ||
		strings.Contains(lowerCT, "text/xml") ||
		strings.Contains(lowerCT, "text/plain") ||
		strings.Contains(lowerCT, "mpegurl") {
		shouldCache = false
	}

	if len(data) > 0 {
		peekLimit := 512
		if len(data) < peekLimit {
			peekLimit = len(data)
		}
		head := data[:peekLimit]
		if bytes.HasPrefix(bytes.TrimSpace(head), []byte("<html")) ||
			bytes.HasPrefix(bytes.TrimSpace(head), []byte("<!DOCTYPE")) ||
			bytes.HasPrefix(bytes.TrimSpace(head), []byte("{")) ||
			bytes.Contains(head, m3u8Tag) {
			shouldCache = false
		}
	}

	ttl := SegmentTTL
	if shouldCache {
		if strings.HasSuffix(strings.ToLower(targetURL), ".mp4") ||
			strings.HasSuffix(strings.ToLower(targetURL), ".m4s") ||
			strings.Contains(lowerCT, "video/mp4") {
			ttl = InitSegmentTTL
		}
		globalSegmentCache.Set(cacheKey, data, headers, ttl)
	} // else: do not cache

	// Clone upstream headers first, then set our diagnostic header after (cannot be overwritten)
	copyHeaders(w.Header(), headers)
	setCORSHeaders(w)

	if shouldCache {
		w.Header().Set("X-Cache", "MISS")
	} else {
		w.Header().Set("X-Cache", "BYPASS-BAD-TYPE")
	}

	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.WriteHeader(200)
	w.Write(data)
}

func handleRangeRequest(w http.ResponseWriter, r *http.Request, targetURL, ua string) {
	reqHeaders := forwardableHeaders(r)

	if r.Method == http.MethodHead {
		handleHeadProxy(w, r, targetURL, ua, reqHeaders)
		return
	}

	resp, err := fetchWithRetry(r.Context(), r.Method, targetURL, ua, reqHeaders)
	if err != nil {
		http.Error(w, "Range fetch error", 502)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.Header().Set("X-Cache", "BYPASS-RANGE-304")
		w.WriteHeader(http.StatusNotModified)
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("Upstream status %d", resp.StatusCode), resp.StatusCode)
		return
	}

	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)

	if resp.StatusCode == 206 {
		w.Header().Set("X-Cache", "BYPASS-RANGE-206")
	} else {
		w.Header().Set("X-Cache", "BYPASS-RANGE-IGNORED")
	}

	if resp.ContentLength >= 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", resp.ContentLength))
	} else {
		w.Header().Del("Content-Length")
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func handleKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	targetURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		targetURL = rawURL
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target URL", 403)
		return
	}

	handlePassThrough(w, r, targetURL, r.URL.Query().Get("moontv-source"), "application/octet-stream", 3600)
}

func handleLogo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	targetURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		targetURL = rawURL
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target URL", 403)
		return
	}

	handlePassThrough(w, r, targetURL, r.URL.Query().Get("moontv-source"), "", 86400)
}

func handleFLV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	targetURL, err := url.QueryUnescape(rawURL)
	if err != nil {
		targetURL = rawURL
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target URL", 403)
		return
	}

	// FLV streams are long-lived, so we treat them like segments but with streaming
	handlePassThrough(w, r, targetURL, r.URL.Query().Get("moontv-source"), "video/x-flv", 0)
}

func handlePassThrough(w http.ResponseWriter, r *http.Request, targetURL, sourceKey, defaultType string, cacheSeconds int) {
	ua := getUserAgent(sourceKey)
	reqHeaders := forwardableHeaders(r)

	// Inject Referer for Huya/Douzhicloud to avoid 403 Forbidden
	if strings.Contains(targetURL, "huya") || strings.Contains(targetURL, "douzhicloud") {
		reqHeaders["Referer"] = "https://www.huya.com/"
	}

	if handleHeadProxy(w, r, targetURL, ua, reqHeaders) {
		return
	}

	resp, err := fetchWithRetry(r.Context(), r.Method, targetURL, ua, reqHeaders)
	if err != nil {
		log.Printf("[Proxy Error] %s %s | Error: %v", r.Method, targetURL, err)
		http.Error(w, fmt.Sprintf("Fetch error: %v", err), 502)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("Upstream error %d", resp.StatusCode), resp.StatusCode)
		return
	}

	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = defaultType
	}
	if ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cacheSeconds > 0 {
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", cacheSeconds))
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", 405)
		return
	}

	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}

	proxyURL := rawURL
	if config.SiteConfig.DoubanImageProxyType == "custom" && config.SiteConfig.DoubanImageProxy != "" {
		if strings.Contains(rawURL, "doubanio.com") {
			proxyURL = config.SiteConfig.DoubanImageProxy + url.QueryEscape(rawURL)
		}
	}

	finalURL, err := url.QueryUnescape(proxyURL)
	if err != nil {
		finalURL = proxyURL
	}
	if err := validateTargetURL(finalURL); err != nil {
		http.Error(w, "Invalid target", 403)
		return
	}

	headers := map[string]string{"Referer": ""}
	if handleHeadProxy(w, r, finalURL, "Mozilla/5.0", headers) {
		return
	}

	resp, err := fetchWithRetry(r.Context(), r.Method, finalURL, "Mozilla/5.0", headers)
	if err != nil {
		log.Printf("[Image Proxy Error] %s | Error: %v", finalURL, err)
		http.Error(w, fmt.Sprintf("Fetch error: %v", err), 502)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("Upstream error %d", resp.StatusCode), resp.StatusCode)
		return
	}

	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)

	cacheTTL := config.SiteConfig.ImageCacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 30
	}
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", cacheTTL*86400))

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ===== M3U8 Rewrites =====

func resolveURL(baseURL, relativePath string) string {
	if strings.HasPrefix(relativePath, "http://") || strings.HasPrefix(relativePath, "https://") {
		return relativePath
	}
	if strings.HasPrefix(relativePath, "//") {
		base, _ := url.Parse(baseURL)
		return base.Scheme + ":" + relativePath
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return relativePath
	}
	ref, err := url.Parse(relativePath)
	if err != nil {
		return relativePath
	}
	return base.ResolveReference(ref).String()
}

func getBaseURL(m3u8URL string) string {
	parsed, err := url.Parse(m3u8URL)
	if err != nil {
		if idx := strings.LastIndex(m3u8URL, "/"); idx != -1 {
			return m3u8URL[:idx+1]
		}
		return m3u8URL
	}
	if strings.HasSuffix(parsed.Path, ".m3u8") {
		parsed.Path = path.Dir(parsed.Path)
		if !strings.HasSuffix(parsed.Path, "/") {
			parsed.Path += "/"
		}
	} else if !strings.HasSuffix(parsed.Path, "/") {
		parsed.Path += "/"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func rewriteM3U8(content, baseURL, proxyBase, sourceKey string, allowCORS bool) string {
	lines := strings.Split(content, "\n")
	var result []string
	pendingStreamInf := false

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			result = append(result, "")
			continue
		}

		if !strings.HasPrefix(line, "#") {
			resolved := resolveURL(baseURL, line)
			var proxyURL string
			if pendingStreamInf {
				proxyURL = fmt.Sprintf("%s/m3u8?url=%s&moontv-source=%s",
					proxyBase, url.QueryEscape(resolved), url.QueryEscape(sourceKey))
				pendingStreamInf = false
			} else if allowCORS {
				proxyURL = resolved
			} else {
				proxyURL = fmt.Sprintf("%s/segment?url=%s&moontv-source=%s",
					proxyBase, url.QueryEscape(resolved), url.QueryEscape(sourceKey))
			}
			result = append(result, proxyURL)
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-MAP:") {
			line = rewriteURITag(line, baseURL, proxyBase, "/segment", sourceKey)
		} else if strings.HasPrefix(line, "#EXT-X-KEY:") {
			line = rewriteURITag(line, baseURL, proxyBase, "/key", sourceKey)
		} else if strings.HasPrefix(line, "#EXT-X-MEDIA:") {
			line = rewriteURITag(line, baseURL, proxyBase, "/m3u8", sourceKey)
		} else if strings.HasPrefix(line, "#EXT-X-I-FRAME-STREAM-INF:") {
			line = rewriteURITag(line, baseURL, proxyBase, "/m3u8", sourceKey)
		}

		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			pendingStreamInf = true
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func rewriteURITag(line, baseURL, proxyBase, endpoint, sourceKey string) string {
	matches := uriRegex.FindStringSubmatch(line)
	if len(matches) < 2 {
		return line
	}
	resolved := resolveURL(baseURL, matches[1])
	proxyURL := fmt.Sprintf("%s%s?url=%s&moontv-source=%s",
		proxyBase, endpoint, url.QueryEscape(resolved), url.QueryEscape(sourceKey))
	return uriRegex.ReplaceAllString(line, fmt.Sprintf(`URI="%s"`, proxyURL))
}

// ===== Middleware & Logging =====

type statusWriter struct {
	http.ResponseWriter
	status int
	length int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	n, err := w.ResponseWriter.Write(b)
	w.length += n
	return n, err
}

func logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		duration := time.Since(start)

		if sw.status >= 400 || duration > time.Second {
			log.Printf("%d | %s | %s | %v | %d bytes",
				sw.status, r.Method, r.URL.Path, duration, sw.length)
		}
	})
}

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, Origin, Accept, If-Match, If-None-Match, If-Modified-Since, If-Range, If-Unmodified-Since")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, X-Cache, ETag, Last-Modified, Cache-Control")
}

func handleCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			setCORSHeaders(w)
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(200)
	w.Write([]byte("OK"))
}

// ===== Main =====

func main() {
	addr := flag.String("addr", ":8080", "Listen address")
	cfgPath := flag.String("config", "", "Path to config JSON file")
	flag.Parse()

	if *cfgPath != "" {
		configPath = *cfgPath
		if err := loadConfig(configPath); err != nil {
			log.Printf("Config error: %v", err)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/proxy/m3u8", handleM3U8)
	mux.HandleFunc("/api/proxy/segment", handleSegment)
	mux.HandleFunc("/api/proxy/key", handleKey)
	mux.HandleFunc("/api/proxy/logo", handleLogo)
	mux.HandleFunc("/api/proxy/flv", handleFLV)
	mux.HandleFunc("/api/image-proxy", handleImageProxy)
	mux.HandleFunc("/health", handleHealth)

	handler := logRequest(handleCORS(mux))

	server := &http.Server{
		Addr:         *addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	done := make(chan bool, 1)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("Server is shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Fatalf("Could not gracefully shutdown the server: %v\n", err)
		}
		close(done)
	}()

	log.Printf("🚀 LunaTV Neutron Star Proxy (Patched) starting on %s", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Could not listen on %s: %v\n", *addr, err)
	}

	<-done
	log.Println("Server stopped")
}
