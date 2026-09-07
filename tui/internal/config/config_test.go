package config

import (
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func clearEnv(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"AI_USAGE_BOARD_URL",
		"AI_USAGE_BOARD_TOKEN",
		"AI_USAGE_BOARD_INTERVAL",
		"AI_USAGE_BOARD_TIMEOUT",
	} {
		t.Setenv(name, "")
	}
}

// pointExecutableDirAt 让 loadFileConfig 从 dir 读取 config.toml。
func pointExecutableDirAt(t *testing.T, dir string) {
	t.Helper()
	orig := executableDir
	executableDir = func() (string, error) { return dir, nil }
	t.Cleanup(func() { executableDir = orig })
}

func writeConfigFile(t *testing.T, dir, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, configFileName), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestParseFlags(t *testing.T) {
	clearEnv(t)
	pointExecutableDirAt(t, t.TempDir())

	cfg, showVersion, err := Parse([]string{
		"--server", "https://usage.example.com/",
		"--token", "secret",
		"--interval", "45s",
		"--timeout", "5s",
	})
	if err != nil {
		t.Fatal(err)
	}
	if showVersion {
		t.Fatal("version should not be requested")
	}
	if cfg.ServerURL != "https://usage.example.com/" || cfg.Token != "secret" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.RefreshInterval != 45*time.Second || cfg.Timeout != 5*time.Second {
		t.Fatalf("unexpected durations: %#v", cfg)
	}
}

func TestParseUsesFiveMinuteDefaultInterval(t *testing.T) {
	clearEnv(t)
	pointExecutableDirAt(t, t.TempDir())

	cfg, _, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RefreshInterval != 5*time.Minute {
		t.Fatalf("default refresh interval = %s, want 5m", cfg.RefreshInterval)
	}
	if cfg.ServerURL != "http://localhost:5173" {
		t.Fatalf("default server = %s, want http://localhost:5173", cfg.ServerURL)
	}
}

func TestParseHelp(t *testing.T) {
	_, _, err := Parse([]string{"--help"})
	if !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("expected flag.ErrHelp, got %v", err)
	}
}

func TestParseRejectsNegativeInterval(t *testing.T) {
	_, _, err := Parse([]string{"--interval", "-1s"})
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestParseReadsConfigFileNextToExecutable(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	pointExecutableDirAt(t, dir)
	writeConfigFile(t, dir, `
server = "http://100.64.0.1:8050"
token = "file-token"
interval = "45s"
timeout = "7s"
`)

	cfg, _, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "http://100.64.0.1:8050" || cfg.Token != "file-token" {
		t.Fatalf("config.toml values not applied: %#v", cfg)
	}
	if cfg.RefreshInterval != 45*time.Second || cfg.Timeout != 7*time.Second {
		t.Fatalf("config.toml durations not applied: %#v", cfg)
	}
}

func TestParseEnvOverridesConfigFile(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	pointExecutableDirAt(t, dir)
	writeConfigFile(t, dir, `
server = "http://file.example.com"
token = "file-token"
interval = "1m"
timeout = "10s"
`)
	t.Setenv("AI_USAGE_BOARD_URL", "http://env.example.com")
	t.Setenv("AI_USAGE_BOARD_INTERVAL", "2m")

	cfg, _, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "http://env.example.com" {
		t.Fatalf("env should override config.toml, got %s", cfg.ServerURL)
	}
	if cfg.Token != "file-token" {
		t.Fatalf("token should fall back to config.toml, got %q", cfg.Token)
	}
	if cfg.RefreshInterval != 2*time.Minute {
		t.Fatalf("interval should come from env, got %s", cfg.RefreshInterval)
	}
	if cfg.Timeout != 10*time.Second {
		t.Fatalf("timeout should come from config.toml, got %s", cfg.Timeout)
	}
}

func TestParseFlagsOverrideConfigFile(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	pointExecutableDirAt(t, dir)
	writeConfigFile(t, dir, `
server = "http://file.example.com"
token = "file-token"
`)

	cfg, _, err := Parse([]string{"--server", "http://flag.example.com", "--token", "flag-token"})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "http://flag.example.com" || cfg.Token != "flag-token" {
		t.Fatalf("flags should override config.toml, got %#v", cfg)
	}
}

func TestParseIgnoresMissingConfigFile(t *testing.T) {
	clearEnv(t)
	pointExecutableDirAt(t, t.TempDir())

	cfg, _, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ServerURL != "http://localhost:5173" || cfg.Token != "" {
		t.Fatalf("unexpected config without file: %#v", cfg)
	}
}

func TestParseReportsBrokenConfigFile(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	pointExecutableDirAt(t, dir)
	writeConfigFile(t, dir, "server = [broken")

	_, _, err := Parse(nil)
	if err == nil {
		t.Fatal("expected an error for broken config.toml")
	}
	if !strings.Contains(err.Error(), "config.toml") {
		t.Fatalf("error should mention config.toml, got: %v", err)
	}
}

func TestParseReportsBrokenIntervalInConfigFile(t *testing.T) {
	clearEnv(t)
	dir := t.TempDir()
	pointExecutableDirAt(t, dir)
	writeConfigFile(t, dir, "interval = \"not-a-duration\"")

	_, _, err := Parse(nil)
	if err == nil {
		t.Fatal("expected an error for broken interval")
	}
	if !strings.Contains(err.Error(), "AI_USAGE_BOARD_INTERVAL") {
		t.Fatalf("error should mention env name, got: %v", err)
	}
}
