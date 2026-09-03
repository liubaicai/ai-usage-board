package config

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const defaultServerURL = "http://localhost:5173"

type Config struct {
	ServerURL       string
	Token           string
	RefreshInterval time.Duration
	Timeout         time.Duration
}

func Parse(args []string) (Config, bool, error) {
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			return Config{}, false, flag.ErrHelp
		}
	}

	serverDefault := firstNonEmpty(os.Getenv("AI_USAGE_BOARD_URL"), defaultServerURL)
	tokenDefault := os.Getenv("AI_USAGE_BOARD_TOKEN")
	intervalDefault, err := durationEnv("AI_USAGE_BOARD_INTERVAL", 30*time.Second)
	if err != nil {
		return Config{}, false, err
	}
	timeoutDefault, err := durationEnv("AI_USAGE_BOARD_TIMEOUT", 30*time.Second)
	if err != nil {
		return Config{}, false, err
	}

	fs := flag.NewFlagSet("ai-usage-tui", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	server := fs.String("server", serverDefault, "ai-usage-board 服务地址")
	token := fs.String("token", tokenDefault, "公共 API Token")
	interval := fs.Duration("interval", intervalDefault, "自动刷新间隔，0 表示关闭")
	timeout := fs.Duration("timeout", timeoutDefault, "HTTP 请求超时")
	showVersion := fs.Bool("version", false, "显示版本")
	if err := fs.Parse(args); err != nil {
		return Config{}, false, fmt.Errorf("参数错误: %w\n\n%s", err, Usage())
	}
	if fs.NArg() > 0 {
		return Config{}, false, fmt.Errorf("未知参数: %s\n\n%s", strings.Join(fs.Args(), " "), Usage())
	}
	if *interval < 0 {
		return Config{}, false, fmt.Errorf("interval 不能小于 0")
	}
	if *timeout <= 0 {
		return Config{}, false, fmt.Errorf("timeout 必须大于 0")
	}

	return Config{
		ServerURL:       strings.TrimSpace(*server),
		Token:           strings.TrimSpace(*token),
		RefreshInterval: *interval,
		Timeout:         *timeout,
	}, *showVersion, nil
}

func durationEnv(name string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("环境变量 %s 不是有效时长: %w", name, err)
	}
	return parsed, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func Usage() string {
	return `用法: ai-usage-tui [选项]

选项:
  --server URL       服务地址（默认 http://localhost:5173）
  --token TOKEN      公共 API Token，推荐改用环境变量传入
  --interval 30s     自动刷新间隔，0 表示关闭
  --timeout 30s      HTTP 请求超时
  --version          显示版本

环境变量:
  AI_USAGE_BOARD_URL, AI_USAGE_BOARD_TOKEN,
  AI_USAGE_BOARD_INTERVAL, AI_USAGE_BOARD_TIMEOUT
`
}
