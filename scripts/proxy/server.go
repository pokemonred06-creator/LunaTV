// LunaTV Go Proxy Server
// Replaces Next.js API proxy routes with high-performance Go implementation.
// Routes:
//   GET /api/proxy/m3u8?url=<url>&moontv-source=<key>&allowCORS=<bool>
//   GET /api/proxy/segment?url=<url>&moontv-source=<key>
//   GET /api/proxy/key?url=<url>&moontv-source=<key>
//   GET /api/proxy/logo?url=<url>&moontv-source=<key>
//   GET /api/image-proxy?url=<url>
//   GET /health

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"regexp"
	"strings"
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
	uriRegex   = regexp.MustCompile(`URI="([^"]+)"`)
	client     *http.Client
)

const DefaultUserAgent = "AptvPlayer/1.4.10"

// ===== Initialization =====

func init() {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		DisableCompression:  true,
		ForceAttemptHTTP2:   true,
	}
	client = &http.Client{
		Transport: transport,
		Timeout:   60 * time.Second,
	}
}

func loadConfig(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("Warning: Could not load config from %s: %v", path, err)
		return nil
	}
	return json.Unmarshal(data, &config)
}

func getUserAgent(sourceKey string) string {
	ua, _ := getUserAgentStrict(sourceKey)
	return ua
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

// ===== URL Utilities =====

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

// ===== SSRF Protection =====

var allowedImageDomains = []string{
	"doubanio.com", "douban.com",
}

func validateImageURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	hostname := parsed.Hostname()
	for _, d := range allowedImageDomains {
		if strings.EqualFold(hostname, d) || strings.HasSuffix(hostname, "."+d) {
			return true
		}
	}
	return false
}

// ===== HTTP Helpers =====

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, Origin, Accept")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range")
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func fetch(targetURL, userAgent string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return client.Do(req)
}

// ===== M3U8 Rewriting =====

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
		}
		if strings.HasPrefix(line, "#EXT-X-KEY:") {
			line = rewriteURITag(line, baseURL, proxyBase, "/key", sourceKey)
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

// ===== Handlers =====

func handleM3U8(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, 400, "Missing url")
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	allowCORS := r.URL.Query().Get("allowCORS") == "true"
	ua := getUserAgent(sourceKey)

	targetURL, _ := url.QueryUnescape(rawURL)
	resp, err := fetch(targetURL, ua, nil)
	if err != nil {
		log.Printf("M3U8 fetch error: %v", err)
		writeError(w, 500, "Failed to fetch m3u8")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		writeError(w, resp.StatusCode, "Upstream error")
		return
	}

	contentType := resp.Header.Get("Content-Type")
	isM3U8 := strings.Contains(strings.ToLower(contentType), "mpegurl") ||
		strings.Contains(strings.ToLower(contentType), "octet-stream")

	setCORSHeaders(w)

	if isM3U8 {
		body, _ := io.ReadAll(resp.Body)
		finalURL := resp.Request.URL.String()
		baseURL := getBaseURL(finalURL)

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
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-cache")
		w.Write([]byte(rewritten))
	} else {
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "no-cache")
		io.Copy(w, resp.Body)
	}
}

func handleSegment(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, 400, "Missing url")
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	ua := getUserAgent(sourceKey)

	targetURL, _ := url.QueryUnescape(rawURL)
	resp, err := fetch(targetURL, ua, nil)
	if err != nil {
		log.Printf("Segment fetch error: %v", err)
		writeError(w, 500, "Failed to fetch segment")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		writeError(w, resp.StatusCode, "Upstream error")
		return
	}

	setCORSHeaders(w)
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Accept-Ranges", "bytes")
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}

	// Flush headers immediately for streaming
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	// Zero-copy streaming
	io.Copy(w, resp.Body)
}

func handleKey(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, 400, "Missing url")
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	ua := getUserAgent(sourceKey)

	targetURL, _ := url.QueryUnescape(rawURL)
	resp, err := fetch(targetURL, ua, nil)
	if err != nil {
		log.Printf("Key fetch error: %v", err)
		writeError(w, 500, "Failed to fetch key")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		writeError(w, resp.StatusCode, "Upstream error")
		return
	}

	setCORSHeaders(w)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	io.Copy(w, resp.Body)
}

func handleLogo(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, 400, "Missing url")
		return
	}

	sourceKey := r.URL.Query().Get("moontv-source")
	ua := getUserAgent(sourceKey)

	targetURL, _ := url.QueryUnescape(rawURL)
	resp, err := fetch(targetURL, ua, nil)
	if err != nil {
		log.Printf("Logo fetch error: %v", err)
		writeError(w, 500, "Failed to fetch image")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		writeError(w, resp.StatusCode, "Upstream error")
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, resp.Body)
}

func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeError(w, 400, "Missing url parameter")
		return
	}

	if !validateImageURL(rawURL) {
		writeError(w, 403, "Forbidden Domain")
		return
	}

	// Apply custom proxy URL if configured
	proxyURL := rawURL
	if config.SiteConfig.DoubanImageProxyType == "custom" && config.SiteConfig.DoubanImageProxy != "" {
		if strings.Contains(rawURL, "doubanio.com") {
			proxyURL = config.SiteConfig.DoubanImageProxy + url.QueryEscape(rawURL)
		}
	}

	headers := map[string]string{
		"Referer": "https://movie.douban.com/",
	}
	resp, err := fetch(proxyURL, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", headers)
	if err != nil {
		log.Printf("Image fetch error: %v", err)
		writeError(w, 500, "Internal Server Error")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		writeError(w, resp.StatusCode, "Failed to fetch image")
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)

	// Use configured cache TTL or default to 30 days
	cacheTTL := config.SiteConfig.ImageCacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 30
	}
	maxAge := cacheTTL * 24 * 60 * 60
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", maxAge))
	io.Copy(w, resp.Body)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(200)
	w.Write([]byte("OK"))
}

// ===== Middleware =====

func logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
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

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		log.Println("Shutting down...")
		server.Close()
	}()

	log.Printf("🚀 LunaTV Proxy starting on %s", *addr)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
