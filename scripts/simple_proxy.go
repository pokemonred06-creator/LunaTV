package main

import (
	"fmt"
	"io"
	"net/http"
)

func handleProxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "Missing url param", 400)
		return
	}

	// Create request
	req, err := http.NewRequest("GET", target, nil)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	// Copy headers but strip host/origin/referer
	for k, v := range r.Header {
		if k != "Host" && k != "Origin" && k != "Referer" {
			req.Header[k] = v
		}
	}
	// Spoof valid browser headers
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), 502)
		return
	}
	defer resp.Body.Close()

	// Copy headers back
	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	// Add CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func main() {
	http.HandleFunc("/proxy", handleProxy)
	fmt.Println("Proxy running on :8081")
	http.ListenAndServe(":8081", nil)
}
