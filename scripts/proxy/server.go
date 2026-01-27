// LunaTV Go Proxy Server
// Replaces Next.js API proxy routes with high-performance Go implementation.
// Golden Master Release V6.6.1: Production Final (Frozen).

package main

import (
	"bytes"
	"container/list"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ===== Configuration =====

var (
	config      Config
	configPath  string
	client      *http.Client
	proxySecret string // Set via env PROXY_SECRET or -secret flag
	devMode     bool

	uriRegex = regexp.MustCompile(`URI="([^"]+)"`)

	// Concurrency Control: Global Semaphore
	// Limits concurrent upstream fetches to 200 total (Segments + FLV + Range)
	globalSem = make(chan struct{}, 200)

	hopByHopHeaders        = map[string]bool{"Connection": true, "Proxy-Connection": true, "Keep-Alive": true, "Proxy-Authenticate": true, "Proxy-Authorization": true, "Te": true, "Trailer": true, "Transfer-Encoding": true, "Upgrade": true}
	forwardHeaderAllowlist = map[string]bool{"Accept": true, "Accept-Language": true, "Cache-Control": true, "Content-Type": true, "Dnt": true, "If-Match": true, "If-Modified-Since": true, "If-None-Match": true, "If-Range": true, "If-Unmodified-Since": true, "Origin": true, "Pragma": true, "Range": true, "Referer": true, "Sec-Fetch-Dest": true, "Sec-Fetch-Mode": true, "Sec-Fetch-Site": true, "Sec-Fetch-User": true, "X-Requested-With": true}

	// FIX: Removed Content-Encoding to prevent cache mismatches
	cachedHeaderAllowlist = map[string]bool{"Content-Type": true, "Cache-Control": true, "Accept-Ranges": true, "Content-Range": true, "ETag": true, "Last-Modified": true, "Expires": true}

	skipHeaderPool  = sync.Pool{New: func() interface{} { return make(map[string]bool) }}
	m3u8Tag         = []byte("#EXTM3U")
	privateIPBlocks []*net.IPNet
)

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

const (
	DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
	MaxCacheItems    = 1000
	MaxCacheBytes    = 512 * 1024 * 1024
	SegmentTTL       = 20 * time.Second
	InitSegmentTTL   = 5 * time.Minute
	MaxRetries       = 3
	MaxSegmentSize   = 20 * 1024 * 1024
	ReadLimit        = MaxSegmentSize + 1
	PlaylistPeekByte = 2048
)

// ===== HMAC Security (Strict V3) =====

func verifySignature(r *http.Request) bool {
	if devMode {
		return true
	}
	if proxySecret == "" {
		return false
	}

	q := r.URL.Query()
	providedHex := q.Get("sign")
	expires := q.Get("expires")
	targetURL := q.Get("url")

	if providedHex == "" || expires == "" || targetURL == "" {
		return false
	}

	expTime, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || time.Now().Unix() > expTime {
		return false
	}

	rawAllow := q.Get("allowCORS")
	allowStr := ""
	if rawAllow == "true" {
		allowStr = "true"
	} else if rawAllow != "" {
		return false
	}

	provided, err := hex.DecodeString(providedHex)
	if err != nil {
		return false
	}

	mac := hmac.New(sha256.New, []byte(proxySecret))
	mac.Write([]byte(r.URL.Path))
	mac.Write([]byte("|"))
	mac.Write([]byte(targetURL))
	mac.Write([]byte("|"))
	mac.Write([]byte(expires))
	mac.Write([]byte("|"))
	mac.Write([]byte(q.Get("moontv-source")))
	mac.Write([]byte("|"))
	mac.Write([]byte(allowStr))
	expected := mac.Sum(nil)

	return hmac.Equal(provided, expected)
}

func signURLParams(endpointPath, targetURL, sourceKey string, allowCORS bool) string {
	if devMode {
		return ""
	}

	expires := fmt.Sprintf("%d", time.Now().Add(24*time.Hour).Unix())
	allowStr := ""
	if allowCORS {
		allowStr = "true"
	}

	mac := hmac.New(sha256.New, []byte(proxySecret))
	mac.Write([]byte(endpointPath))
	mac.Write([]byte("|"))
	mac.Write([]byte(targetURL))
	mac.Write([]byte("|"))
	mac.Write([]byte(expires))
	mac.Write([]byte("|"))
	mac.Write([]byte(sourceKey))
	mac.Write([]byte("|"))
	mac.Write([]byte(allowStr))
	signature := hex.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("&expires=%s&sign=%s", expires, signature)
}

// ===== Initialization & Security =====

func init() {
	rand.Seed(time.Now().UnixNano())
	for _, cidr := range []string{
		"0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fe80::/10", "fc00::/7", "ff00::/8",
	} {
		_, block, err := net.ParseCIDR(cidr)
		if err == nil {
			privateIPBlocks = append(privateIPBlocks, block)
		}
	}

	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	baseTLSConfig := &tls.Config{MinVersion: tls.VersionTLS12}

	transport := &http.Transport{
		Proxy:                 nil, // Security: Ignore HTTP_PROXY
		DialContext:           guardedDialContext(dialer),
		DialTLSContext:        guardedDialTLSContext(dialer, baseTLSConfig),
		TLSClientConfig:       baseTLSConfig,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableCompression:    false,
		ForceAttemptHTTP2:     true,
	}

	client = &http.Client{
		Transport: transport,
		Timeout:   0,
		Jar:       nil,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("stopped after 3 redirects")
			}
			return nil
		},
	}
}

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

func isSafePublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	ip = ip.To16()
	if ip == nil || !ip.IsGlobalUnicast() || isPrivateIP(ip) {
		return false
	}
	return true
}

func resolveAndPickSafeIP(ctx context.Context, host string) (net.IP, error) {
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("no resolved ip")
	}
	safeIPs := make([]net.IP, 0, len(ips))
	for _, ipa := range ips {
		if isSafePublicIP(ipa.IP) {
			safeIPs = append(safeIPs, ipa.IP)
		}
	}
	if len(safeIPs) == 0 {
		return nil, errors.New("ssrf blocked: no usable public ip")
	}
	return safeIPs[rand.Intn(len(safeIPs))], nil
}

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
		tlsConfig := buildTLSConfig(base, host)
		tlsConn := tls.Client(rawConn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			rawConn.Close()
			return nil, err
		}
		return tlsConn, nil
	}
}

func buildTLSConfig(base *tls.Config, serverName string) *tls.Config {
	var cfg *tls.Config
	if base != nil {
		cfg = base.Clone()
	} else {
		cfg = &tls.Config{}
	}
	cfg.ServerName = serverName
	if len(cfg.NextProtos) == 0 {
		cfg.NextProtos = []string{"h2", "http/1.1"}
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
	if u.User != nil {
		return errors.New("user info not allowed")
	}
	port := u.Port()
	if port != "" && port != "80" && port != "443" && port != "8080" {
		return errors.New("non-standard port")
	}
	return nil
}

// ===== Cache & Singleflight =====

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
	return &LRUCache{capacity: capacity, maxBytes: maxBytes, items: make(map[string]*list.Element), evictList: list.New()}
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
	item := &CacheItem{Key: key, Data: data, Headers: headerCopy, SizeBytes: itemSize, ExpiresAt: time.Now().Add(ttl)}
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

// FIX: Fail fast if config is invalid
func loadConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &config)
}

func getUserAgent(sourceKey string) string {
	for _, src := range config.LiveConfig {
		if src.Key == sourceKey {
			if src.UA != "" {
				return src.UA
			}
		}
	}
	return DefaultUserAgent
}

func forwardableHeaders(r *http.Request) map[string]string {
	h := make(map[string]string)
	for k, vv := range r.Header {
		if len(vv) > 0 && forwardHeaderAllowlist[http.CanonicalHeaderKey(k)] {
			h[k] = vv[0]
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
				if t := strings.TrimSpace(token); t != "" {
					toSkip[http.CanonicalHeaderKey(t)] = true
				}
			}
		}
	}
	for k, vv := range src {
		if !toSkip[http.CanonicalHeaderKey(k)] {
			dst[k] = append([]string(nil), vv...)
		}
	}
	skipHeaderPool.Put(toSkip)
}

func filterAndCopyHeaders(src http.Header) (http.Header, int64) {
	out := make(http.Header)
	var size int64
	for k, vv := range src {
		if cachedHeaderAllowlist[http.CanonicalHeaderKey(k)] {
			out[k] = append([]string(nil), vv...)
			size += int64(len(k))
			for _, v := range vv {
				size += int64(len(v))
			}
		}
	}
	return out, size
}

func firstCSV(s string) string {
	if i := strings.IndexByte(s, ','); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

func cloneHeadersMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in)+1)
	for k, v := range in {
		out[k] = v
	}
	return out
}

func shouldReturn304FromCache(r *http.Request, cached http.Header) bool {
	if inm := r.Header.Get("If-None-Match"); inm != "" {
		etag := cached.Get("ETag")
		if etag != "" {
			for _, p := range strings.Split(inm, ",") {
				if strings.TrimSpace(p) == etag {
					return true
				}
			}
		}
		return false
	}
	if ims := r.Header.Get("If-Modified-Since"); ims != "" {
		if lm := cached.Get("Last-Modified"); lm != "" {
			t1, e1 := http.ParseTime(ims)
			t2, e2 := http.ParseTime(lm)
			if e1 == nil && e2 == nil && !t2.After(t1) {
				return true
			}
		}
	}
	return false
}

// FIX: New helper for correctness
func hasStrongPreconditions(r *http.Request) bool {
	return r.Header.Get("If-Match") != "" || r.Header.Get("If-Unmodified-Since") != ""
}

func acquireSemaphore(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	select {
	case globalSem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return errors.New("server busy (queue timeout)")
	}
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
			if resp.StatusCode < 500 && resp.StatusCode != 429 {
				return resp, nil
			}
			resp.Body.Close()
		} else if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(200*(1<<i)+rand.Intn(100)) * time.Millisecond):
		}
	}
	return resp, err
}

func handleHeadProxy(w http.ResponseWriter, r *http.Request, targetURL, ua string, reqHeaders map[string]string) bool {
	if r.Method != http.MethodHead {
		return false
	}
	resp, err := fetchWithRetry(r.Context(), "HEAD", targetURL, ua, reqHeaders)
	if err != nil {
		http.Error(w, "HEAD error", 502)
		return true
	}
	defer resp.Body.Close()
	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)
	w.WriteHeader(resp.StatusCode)
	return true
}

func resolveURL(baseURL, relativePath string) string {
	if strings.HasPrefix(relativePath, "http") {
		return relativePath
	}
	base, _ := url.Parse(baseURL)
	ref, _ := url.Parse(relativePath)
	return base.ResolveReference(ref).String()
}

func getBaseURL(m3u8URL string) string {
	u, _ := url.Parse(m3u8URL)
	if strings.HasSuffix(u.Path, ".m3u8") {
		u.Path = path.Dir(u.Path) + "/"
	} else if !strings.HasSuffix(u.Path, "/") {
		u.Path += "/"
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func rewriteM3U8(content, baseURL, proxyBase, sourceKey string, allowCORS bool) string {
	// [FORCE HTTPS]
	// Ensure the proxy base itself is HTTPS to match the site origin
	if strings.HasPrefix(proxyBase, "http://") {
		proxyBase = strings.Replace(proxyBase, "http://", "https://", 1)
	}

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
			// Resolve to absolute URL always
			resolved := resolveURL(baseURL, line)

			// [HTTPS CHECK moved down]

			// [DIRECT PLAY MODE]
			// User requested segments to be played directly from the source to reduce CPU load.
			// OR if it is a nested M3U8 playlist, we MUST proxy it to keep control.

			if pendingStreamInf || strings.HasSuffix(resolved, ".m3u8") {
				// It's a playlist (Adaptive Stream), proxy it!
				endpoint := "/m3u8"
				signedParams := signURLParams("/api/proxy"+endpoint, resolved, sourceKey, allowCORS)
				proxyURL := fmt.Sprintf("%s%s?url=%s&moontv-source=%s%s", proxyBase, endpoint, url.QueryEscape(resolved), url.QueryEscape(sourceKey), signedParams)
				if allowCORS {
					proxyURL += "&allowCORS=true"
				}
				result = append(result, proxyURL)
				pendingStreamInf = false
				continue
			}

			// Otherwise, it's a SEGMENT (TS, JS, etc). Leave it as absolute URL (Direct Play).

			// [HTTPS UPGRADE]
			// Upgrade direct upstream links to HTTPS to avoid Mixed Content blocking.
			// This is REQUIRED for Direct Play as the browser fetches these.
			if strings.HasPrefix(resolved, "http://") {
				resolved = strings.Replace(resolved, "http://", "https://", 1)
			}

			result = append(result, resolved)
			continue
		}

		if strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			pendingStreamInf = true
		}

		if strings.Contains(line, `URI="`) {
			line = uriRegex.ReplaceAllStringFunc(line, func(match string) string {
				sub := uriRegex.FindStringSubmatch(match)
				if len(sub) < 2 {
					return match
				}
				resolved := resolveURL(baseURL, sub[1])

				// [HTTPS CHECK moved down]

				// Only proxy if it looks like a playlist, otherwise direct
				if strings.HasSuffix(resolved, ".m3u8") {
					endpoint := "/m3u8"
					signedParams := signURLParams("/api/proxy"+endpoint, resolved, sourceKey, allowCORS)
					pURL := fmt.Sprintf("%s%s?url=%s&moontv-source=%s%s", proxyBase, endpoint, url.QueryEscape(resolved), url.QueryEscape(sourceKey), signedParams)
					if allowCORS {
						pURL += "&allowCORS=true"
					}
					return fmt.Sprintf(`URI="%s"`, pURL)
				}

				// Key/Other -> Direct Play (Upgrade to HTTPS)
				if strings.HasPrefix(resolved, "http://") {
					resolved = strings.Replace(resolved, "http://", "https://", 1)
				}
				return fmt.Sprintf(`URI="%s"`, resolved)
			})
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	// 20s timeout
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	r = r.WithContext(ctx)

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
	headers := map[string]string{"Referer": ""}

	// Douban Special Handling (The Fix)
	if strings.Contains(rawURL, "doubanio.com") {
		headers["Referer"] = "https://movie.douban.com/"
		if config.SiteConfig.DoubanImageProxyType == "custom" && config.SiteConfig.DoubanImageProxy != "" {
			// If URL already encoded? No, config usually expects base.
			// Let's assume standard behavior: append param
			// But careful with double encoding if the config is just a prefix
			proxyURL = config.SiteConfig.DoubanImageProxy + url.QueryEscape(rawURL)
		} else {
			// Mirror Fallback
			re := regexp.MustCompile(`img\d*\.doubanio\.com`)
			proxyURL = re.ReplaceAllString(rawURL, "img.doubanio.cmliussss.net")
			if strings.HasPrefix(proxyURL, "http://") {
				proxyURL = strings.Replace(proxyURL, "http://", "https://", 1)
			}
		}
	}

	finalURL := proxyURL
	if err := validateTargetURL(finalURL); err != nil {
		http.Error(w, "Invalid target", 403)
		return
	}

	if handleHeadProxy(w, r, finalURL, DefaultUserAgent, headers) {
		return
	}

	resp, err := fetchWithRetry(ctx, r.Method, finalURL, DefaultUserAgent, headers)
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			log.Printf("[Image Proxy Error] %s | Error: %v", finalURL, err)
			http.Error(w, "Fetch error", 502)
		}
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if resp.StatusCode >= 300 {
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
	// Relaxed Cache Control (The Fix)
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, stale-while-revalidate=%d", cacheTTL*86400, cacheTTL*86400))

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ===== Handlers =====

func commonHandler(w http.ResponseWriter, r *http.Request, handlerType string) {
	if r.Method == "OPTIONS" {
		setCORSHeaders(w)
		w.WriteHeader(204)
		return
	}

	if !verifySignature(r) {
		http.Error(w, "Forbidden: Invalid Signature", 403)
		return
	}
	if err := acquireSemaphore(r.Context()); err != nil {
		http.Error(w, err.Error(), 503)
		return
	}
	defer func() { <-globalSem }()

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	r = r.WithContext(ctx)

	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "Missing url", 400)
		return
	}
	if err := validateTargetURL(targetURL); err != nil {
		http.Error(w, "Invalid target", 400)
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	allowCORS := r.URL.Query().Get("allowCORS") == "true"
	ua := getUserAgent(sourceKey)
	reqHeaders := forwardableHeaders(r)

	if strings.Contains(targetURL, "huya") {
		reqHeaders["Referer"] = "https://www.huya.com/"
	}

	if handleHeadProxy(w, r, targetURL, ua, reqHeaders) {
		return
	}

	// M3U8 Logic
	if handlerType == "m3u8" {
		reqHeaders["Accept-Encoding"] = "identity"

		resp, err := fetchWithRetry(ctx, "GET", targetURL, ua, reqHeaders)
		if err != nil {
			http.Error(w, "Fetch error", 502)
			return
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
		if err != nil {
			http.Error(w, "Read error", 502)
			return
		}

		if bytes.Contains(body, m3u8Tag) || strings.Contains(resp.Header.Get("Content-Type"), "mpegurl") {
			scheme := "http"
			if r.TLS != nil || strings.EqualFold(firstCSV(r.Header.Get("X-Forwarded-Proto")), "https") {
				scheme = "https"
			}
			host := r.Host
			if fh := firstCSV(r.Header.Get("X-Forwarded-Host")); fh != "" {
				host = fh
			}
			proxyBase := fmt.Sprintf("%s://%s/api/proxy", scheme, host)

			baseURL := getBaseURL(resp.Request.URL.String())
			rewritten := rewriteM3U8(string(body), baseURL, proxyBase, sourceKey, allowCORS)

			copyHeaders(w.Header(), resp.Header)
			setCORSHeaders(w)

			w.Header().Del("Content-Length")
			w.Header().Del("Content-Encoding")
			w.Header().Del("ETag")
			w.Header().Del("Last-Modified")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")

			w.WriteHeader(resp.StatusCode)
			w.Write([]byte(rewritten))
			return
		}
		copyHeaders(w.Header(), resp.Header)
		setCORSHeaders(w)
		w.WriteHeader(resp.StatusCode)
		w.Write(body)
		return
	}

	// Segment Logic
	if handlerType == "segment" {
		// FIX: Bypass cache if strong preconditions (If-Match) are present
		bypassCache := r.Header.Get("Range") != "" || hasStrongPreconditions(r)

		if bypassCache {
			if r.Header.Get("Range") != "" {
				reqHeaders["Range"] = r.Header.Get("Range")
			}
			// Preconditions are already in reqHeaders via forwardableHeaders

			// Force identity to avoid gzip mismatch if we are bypassing cache but upstream sends gzip
			reqHeaders["Accept-Encoding"] = "identity"

			resp, err := fetchWithRetry(ctx, r.Method, targetURL, ua, reqHeaders)
			if err != nil {
				http.Error(w, "Fetch error", 502)
				return
			}
			defer resp.Body.Close()
			copyHeaders(w.Header(), resp.Header)
			setCORSHeaders(w)
			w.Header().Set("X-Cache", "BYPASS")
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			return
		}

		cacheKey := sourceKey + "|" + targetURL
		if data, h, ok := globalSegmentCache.Get(cacheKey); ok {
			if shouldReturn304FromCache(r, h) {
				copyHeaders(w.Header(), h)
				setCORSHeaders(w)
				w.Header().Set("X-Cache", "HIT-304")
				w.WriteHeader(304)
				return
			}
			copyHeaders(w.Header(), h)
			setCORSHeaders(w)
			w.Header().Set("X-Cache", "HIT")
			w.Header().Set("Content-Length", strconv.Itoa(len(data)))
			w.Write(data)
			return
		}

		data, h, err := sfGroup.Do(cacheKey, func() ([]byte, http.Header, error) {
			localHeaders := cloneHeadersMap(reqHeaders)
			localHeaders["Accept-Encoding"] = "identity"

			resp, err := fetchWithRetry(r.Context(), "GET", targetURL, ua, localHeaders)
			if err != nil {
				return nil, nil, err
			}
			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				return nil, nil, fmt.Errorf("status %d", resp.StatusCode)
			}
			d, err := io.ReadAll(io.LimitReader(resp.Body, int64(ReadLimit)))
			if len(d) > MaxSegmentSize {
				return nil, nil, errors.New("too large")
			}
			return d, resp.Header, err
		})

		if err != nil {
			http.Error(w, "Segment error", 502)
			return
		}

		ct := h.Get("Content-Type")
		if !strings.Contains(ct, "html") && !strings.Contains(ct, "json") {
			globalSegmentCache.Set(cacheKey, data, h, SegmentTTL)
		}

		copyHeaders(w.Header(), h)
		setCORSHeaders(w)
		w.Header().Set("X-Cache", "MISS")
		w.Write(data)
		return
	}

	// Passthrough
	if r.Header.Get("Range") != "" {
		reqHeaders["Range"] = r.Header.Get("Range")
	}
	resp, err := fetchWithRetry(ctx, r.Method, targetURL, ua, reqHeaders)
	if err != nil {
		http.Error(w, "Fetch error", 502)
		return
	}
	defer resp.Body.Close()
	copyHeaders(w.Header(), resp.Header)
	setCORSHeaders(w)
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// ===== Structs & Middleware =====

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Range, Content-Type")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, X-Cache, ETag, Last-Modified")
}

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
		log.Printf("%s %s %s | %d | %v", r.RemoteAddr, r.Method, r.URL.Path, sw.status, time.Since(start))
	})
}

func main() {
	addr := flag.String("addr", ":8080", "Listen address")
	configFlag := flag.String("config", "", "Config path")
	secretFlag := flag.String("secret", "", "Proxy secret")
	devFlag := flag.Bool("dev", false, "Enable dev mode (no auth)")
	flag.Parse()

	if *configFlag != "" {
		configPath = *configFlag
		if err := loadConfig(configPath); err != nil {
			log.Fatalf("Config load error: %v", err)
		}
	}

	proxySecret = os.Getenv("PROXY_SECRET")
	if *secretFlag != "" {
		proxySecret = *secretFlag
	}
	devMode = *devFlag

	if proxySecret == "" && !devMode {
		log.Fatal("🚨 FATAL: PROXY_SECRET not set. Use -secret or set env var. Use -dev to bypass.")
	}
	if devMode {
		log.Println("⚠️  DEV MODE: Authentication disabled.")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/proxy/m3u8", func(w http.ResponseWriter, r *http.Request) { commonHandler(w, r, "m3u8") })
	mux.HandleFunc("/api/proxy/segment", func(w http.ResponseWriter, r *http.Request) { commonHandler(w, r, "segment") })
	mux.HandleFunc("/api/proxy/ts", func(w http.ResponseWriter, r *http.Request) { commonHandler(w, r, "segment") })
	mux.HandleFunc("/api/proxy/key", func(w http.ResponseWriter, r *http.Request) { commonHandler(w, r, "key") })
	mux.HandleFunc("/api/proxy/flv", func(w http.ResponseWriter, r *http.Request) { commonHandler(w, r, "flv") })
	mux.HandleFunc("/api/image-proxy", handleImageProxy)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("OK")) })

	handler := logRequest(mux)

	server := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	log.Printf("🚀 LunaTV Golden Master Proxy (V6.6.1) starting on %s", *addr)

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(ctx)
	log.Println("🛑 Server stopped")
}
