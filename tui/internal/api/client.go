package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 4 << 20

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(serverURL, token string, timeout time.Duration) (*Client, error) {
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("无效的服务地址 %q，请包含 http:// 或 https://", serverURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("不支持的服务地址协议 %q", parsed.Scheme)
	}
	return &Client{
		baseURL: serverURL,
		token:   strings.TrimSpace(token),
		http:    &http.Client{Timeout: timeout},
	}, nil
}

func (c *Client) BaseURL() string {
	return c.baseURL
}

func (c *Client) Usage(ctx context.Context) (UsageResponse, error) {
	return c.request(ctx, http.MethodGet, "/api/v1/usage")
}

func (c *Client) Refresh(ctx context.Context) (UsageResponse, error) {
	return c.request(ctx, http.MethodPost, "/api/v1/usage/refresh")
}

func (c *Client) request(ctx context.Context, method, path string) (UsageResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return UsageResponse{}, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	res, err := c.http.Do(req)
	if err != nil {
		return UsageResponse{}, fmt.Errorf("连接 %s 失败: %w", c.baseURL, err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return UsageResponse{}, fmt.Errorf("读取 API 响应失败: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var apiError struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &apiError)
		if apiError.Error == "" {
			apiError.Error = strings.TrimSpace(string(body))
		}
		if apiError.Error == "" {
			apiError.Error = res.Status
		}
		return UsageResponse{}, fmt.Errorf("API 返回 %d: %s", res.StatusCode, apiError.Error)
	}

	var result UsageResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return UsageResponse{}, fmt.Errorf("API 响应格式无效: %w", err)
	}
	if result.APIVersion != "v1" {
		return UsageResponse{}, fmt.Errorf("不支持的 API 版本 %q", result.APIVersion)
	}
	return result, nil
}
