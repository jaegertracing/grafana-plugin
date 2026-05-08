package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// proxyToJaeger forwards a CallResource request to the Jaeger backend and buffers the full response before sending.
//
// URL mapping: Grafana routes /api/datasources/uid/<uid>/resources/<path> to CallResource with
// req.Path = <path>. We forward to <jaegerURL>/<path>, preserving the query string and body.
//
// Asset URL rewriting: the proxy does NOT rewrite HTML asset paths. For the Jaeger SPA to load
// correctly all assets must be relative (which they are by default). If Jaeger is configured with
// --query.base-path, that same path must match the prefix used here.
//
// Bearer token propagation: if Grafana passes an Authorization header (from the user's session),
// we forward it to Jaeger so --query.bearer-token-propagation can enforce per-user storage access.
func proxyToJaeger(ctx context.Context, jaegerURL *url.URL, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	target := *jaegerURL
	target.Path = strings.TrimSuffix(target.Path, "/") + "/" + strings.TrimPrefix(req.Path, "/")
	target.RawQuery = req.URL[strings.Index(req.URL, "?")+1:]
	if !strings.Contains(req.URL, "?") {
		target.RawQuery = ""
	}

	var body io.Reader
	if len(req.Body) > 0 {
		body = bytes.NewReader(req.Body)
	}
	outReq, err := http.NewRequestWithContext(ctx, req.Method, target.String(), body)
	if err != nil {
		return fmt.Errorf("building proxy request: %w", err)
	}

	// Forward safe headers; propagate Authorization for bearer token pass-through.
	for _, h := range []string{"Accept", "Accept-Encoding", "Authorization", "Content-Type"} {
		if v, ok := req.Headers[h]; ok && len(v) > 0 {
			outReq.Header.Set(h, v[0])
		}
	}
	outReq.Header.Set("Via", "grafana-jaeger-proxy")

	resp, err := httpClient.Do(outReq)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: 502,
			Body:   []byte(fmt.Sprintf("upstream error: %v", err)),
		})
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading upstream response: %w", err)
	}

	headers := make(map[string][]string)
	for k, v := range resp.Header {
		headers[k] = v
	}

	return sender.Send(&backend.CallResourceResponse{
		Status:  resp.StatusCode,
		Headers: headers,
		Body:    respBody,
	})
}

// checkJaegerReachable does a lightweight GET /api/services to verify connectivity.
func checkJaegerReachable(ctx context.Context, jaegerURL *url.URL) error {
	target := *jaegerURL
	target.Path = strings.TrimSuffix(target.Path, "/") + "/api/services"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}
