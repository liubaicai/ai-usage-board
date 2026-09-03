package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/liubaicai/ai-usage-board/tui/internal/api"
	"github.com/liubaicai/ai-usage-board/tui/internal/config"
	"github.com/liubaicai/ai-usage-board/tui/internal/ui"
)

var version = "dev"

func main() {
	cfg, showVersion, err := config.Parse(os.Args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Print(config.Usage())
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if showVersion {
		fmt.Println(version)
		return
	}

	client, err := api.NewClient(cfg.ServerURL, cfg.Token, cfg.Timeout)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	program := tea.NewProgram(
		ui.New(client, cfg.RefreshInterval),
		tea.WithAltScreen(),
	)
	if _, err := program.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "TUI 运行失败: %v\n", err)
		os.Exit(1)
	}
}
