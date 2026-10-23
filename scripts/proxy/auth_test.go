package main

import (
	"net/http/httptest"
	"testing"
)

func TestMediaSignatureRequired(t *testing.T) {
	oldSecret, oldDev := proxySecret, devMode
	defer func() { proxySecret, devMode = oldSecret, oldDev }()
	proxySecret, devMode = "test-secret", false
	path := "/api/proxy/m3u8"
	target := "https://media.example/index.m3u8"
	unsigned := httptest.NewRequest("GET", path+"?url="+target, nil)
	if verifySignature(unsigned) {
		t.Fatal("unsigned manifest request was accepted")
	}
	signed := httptest.NewRequest("GET", path+"?url="+target+signURLParams(path, target, "", false), nil)
	if !verifySignature(signed) {
		t.Fatal("signed manifest request was rejected")
	}
	signed.URL.Path = "/api/proxy/ts"
	if verifySignature(signed) {
		t.Fatal("signature survived a path change")
	}
}
