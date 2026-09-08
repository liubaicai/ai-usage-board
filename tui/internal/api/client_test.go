package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestUsageSendsBearerTokenAndDecodesResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/usage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("unexpected authorization header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"apiVersion":"v1","summary":{"total":1},"accounts":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Usage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.Total != 1 {
		t.Fatalf("unexpected total: %d", result.Summary.Total)
	}
}

func TestRefreshUsesPost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/usage/refresh" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"apiVersion":"v1","summary":{},"accounts":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshAccountPostsToAccountScopedEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		want := "/api/v1/usage/refresh/acc-1"
		if r.URL.Path != want {
			t.Fatalf("path = %s, want %s", r.URL.Path, want)
		}
		_, _ = w.Write([]byte(`{"apiVersion":"v1","summary":{"total":1},"accounts":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.RefreshAccount(context.Background(), "acc-1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.Total != 1 {
		t.Fatalf("unexpected total: %d", result.Summary.Total)
	}
}
