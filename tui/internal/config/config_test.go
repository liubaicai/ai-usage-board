package config

import (
	"errors"
	"flag"
	"testing"
	"time"
)

func TestParseFlags(t *testing.T) {
	t.Setenv("AI_USAGE_BOARD_URL", "")
	t.Setenv("AI_USAGE_BOARD_TOKEN", "")
	t.Setenv("AI_USAGE_BOARD_INTERVAL", "")
	t.Setenv("AI_USAGE_BOARD_TIMEOUT", "")

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
	t.Setenv("AI_USAGE_BOARD_URL", "")
	t.Setenv("AI_USAGE_BOARD_TOKEN", "")
	t.Setenv("AI_USAGE_BOARD_INTERVAL", "")
	t.Setenv("AI_USAGE_BOARD_TIMEOUT", "")

	cfg, _, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RefreshInterval != 5*time.Minute {
		t.Fatalf("default refresh interval = %s, want 5m", cfg.RefreshInterval)
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
