package config

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

const defaultServerURL = "http://localhost:5173"
const configFileName = "config.toml"

// executableDir 返回可执行文件所在目录；包级变量便于测试替换。
var executableDir = func() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

type Config struct {
	ServerURL       string
	Token           string
	RefreshInterval time.Duration
	Timeout         time.Duration
}

// fileConfig 对应 config.toml（与可执行文件同目录）的配置键，
// 与 AI_USAGE_BOARD_* 环境变量一一对应。
// interval / timeout 使用 Go duration 字符串，如 "5m"、"30s"。
type fileConfig struct {
	Server   string `toml:"server"`
	Token    string `toml:"token"`
	Interval string `toml:"interval"`
	Timeout  string `toml:"timeout"`
}

func Parse(args []string) (Config, bool, error) {
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			return Config{}, false, flag.ErrHelp
		}
	}

	file, err := loadFileConfig()
	if err != nil {
		return Config{}, false, err
	}

	// 优先级：命令行参数 > 环境变量 > config.toml > 内置默认值
	serverDefault := firstNonEmpty(os.Getenv("AI_USAGE_BOARD_URL"), file.Server, defaultServerURL)
	tokenDefault := firstNonEmpty(os.Getenv("AI_USAGE_BOARD_TOKEN"), file.Token)
	intervalDefault, err := durationValue("AI_USAGE_BOARD_INTERVAL", file.Interval, 5*time.Minute)
	if err != nil {
		return Config{}, false, err
	}
	timeoutDefault, err := durationValue("AI_USAGE_BOARD_TIMEOUT", file.Timeout, 30*time.Second)
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

// loadFileConfig 读取可执行文件同目录的 config.toml。
// 文件不存在时静默返回空配置；存在但无法解析时报错。
func loadFileConfig() (fileConfig, error) {
	dir, err := executableDir()
	if err != nil {
		return fileConfig{}, nil
	}
	path := filepath.Join(dir, configFileName)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fileConfig{}, nil
		}
		return fileConfig{}, fmt.Errorf("读取配置文件失败 %s: %w", path, err)
	}
	var file fileConfig
	if err := toml.Unmarshal(data, &file); err != nil {
		return fileConfig{}, fmt.Errorf("解析配置文件失败 %s: %w", path, err)
	}
	return file, nil
}

// durationValue 依次取环境变量与 config.toml 中的时长字符串并解析，
// 两者都为空时返回 fallback。
func durationValue(envName, fileValue string, fallback time.Duration) (time.Duration, error) {
	raw := firstNonEmpty(os.Getenv(envName), fileValue)
	if raw == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("无效时长 %q（来源：环境变量 %s 或 config.toml）: %w", raw, envName, err)
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
  --interval 5m      自动刷新间隔，0 表示关闭
  --timeout 30s      HTTP 请求超时
  --version          显示版本

配置文件:
  config.toml（与可执行文件同目录，可选）可设置以下键，
  优先级低于环境变量与命令行参数，参考 config.demo.toml：
    server   = "http://localhost:5173"  服务地址
    token    = "..."                    公共 API Token
    interval = "5m"                     自动刷新间隔，0 表示关闭
    timeout  = "30s"                    HTTP 请求超时

环境变量:
  AI_USAGE_BOARD_URL, AI_USAGE_BOARD_TOKEN,
  AI_USAGE_BOARD_INTERVAL, AI_USAGE_BOARD_TIMEOUT
`
}
