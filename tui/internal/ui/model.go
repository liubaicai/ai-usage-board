package ui

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/liubaicai/ai-usage-board/tui/internal/api"
)

type usageMsg struct {
	data api.UsageResponse
}

type errorMsg struct {
	err error
}

type tickMsg struct {
	id int
}

type Model struct {
	client          *api.Client
	data            api.UsageResponse
	spinner         spinner.Model
	refreshInterval time.Duration
	lastLoaded      time.Time
	err             error
	cursor          int
	width           int
	height          int
	timerID         int
	loading         bool
	loaded          bool
}

func New(client *api.Client, refreshInterval time.Duration) Model {
	indicator := spinner.New()
	indicator.Spinner = spinner.Dot
	indicator.Style = lipgloss.NewStyle().Foreground(colorAccent)
	return Model{
		client:          client,
		spinner:         indicator,
		refreshInterval: refreshInterval,
		loading:         true,
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.fetch(false), m.spinner.Tick)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "r":
			if !m.loading {
				return m.startFetch(true)
			}
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.data.Accounts)-1 {
				m.cursor++
			}
		case "home", "g":
			m.cursor = 0
		case "end", "G":
			if len(m.data.Accounts) > 0 {
				m.cursor = len(m.data.Accounts) - 1
			}
		}

	case usageMsg:
		m.data = msg.data
		m.err = nil
		m.loading = false
		m.loaded = true
		m.lastLoaded = time.Now()
		if m.cursor >= len(m.data.Accounts) {
			m.cursor = max(0, len(m.data.Accounts)-1)
		}
		return m, m.scheduleTick()

	case errorMsg:
		m.err = msg.err
		m.loading = false
		return m, m.scheduleTick()

	case tickMsg:
		if msg.id == m.timerID && !m.loading {
			return m.startFetch(true)
		}

	case spinner.TickMsg:
		if m.loading {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			return m, cmd
		}
	}
	return m, nil
}

func (m Model) View() string {
	if m.width == 0 {
		return "正在初始化…"
	}

	contentWidth := max(30, m.width-2)
	header := m.renderHeader(contentWidth)
	summary := m.renderSummary(contentWidth)

	var body string
	if !m.loaded && m.loading {
		body = panelStyle.Width(max(20, contentWidth-4)).Render(m.spinner.View() + " 正在连接服务并读取用量…")
	} else if len(m.data.Accounts) == 0 {
		body = panelStyle.Width(max(20, contentWidth-4)).Render("尚未配置账号，请先在 Web 面板中添加账号。")
	} else if contentWidth >= 92 {
		listWidth := max(34, contentWidth*2/5)
		detailWidth := max(42, contentWidth-listWidth-2)
		body = lipgloss.JoinHorizontal(
			lipgloss.Top,
			m.renderList(listWidth),
			"  ",
			m.renderDetail(detailWidth),
		)
	} else {
		body = lipgloss.JoinVertical(
			lipgloss.Left,
			m.renderList(contentWidth),
			m.renderDetail(contentWidth),
		)
	}

	parts := []string{header, summary}
	if m.err != nil {
		parts = append(parts, errorStyle.Render("错误: "+m.err.Error()))
	}
	parts = append(parts, body, m.renderFooter(contentWidth))
	return lipgloss.NewStyle().Padding(0, 1).Render(strings.Join(parts, "\n"))
}

func (m Model) fetch(refresh bool) tea.Cmd {
	return func() tea.Msg {
		var (
			data api.UsageResponse
			err  error
		)
		if refresh {
			data, err = m.client.Refresh(context.Background())
		} else {
			data, err = m.client.Usage(context.Background())
		}
		if err != nil {
			return errorMsg{err: err}
		}
		return usageMsg{data: data}
	}
}

func (m Model) startFetch(refresh bool) (tea.Model, tea.Cmd) {
	m.loading = true
	m.err = nil
	m.timerID++ // invalidate any outstanding timer
	return m, tea.Batch(m.fetch(refresh), m.spinner.Tick)
}

func (m *Model) scheduleTick() tea.Cmd {
	if m.refreshInterval <= 0 {
		return nil
	}
	m.timerID++
	id := m.timerID
	return tea.Tick(m.refreshInterval, func(time.Time) tea.Msg {
		return tickMsg{id: id}
	})
}

func (m Model) renderHeader(width int) string {
	title := titleStyle.Render("⚡ AI Usage Board TUI")
	state := ""
	if m.loading {
		state = m.spinner.View() + " 刷新中"
	} else if !m.lastLoaded.IsZero() {
		state = "更新于 " + m.lastLoaded.Format("15:04:05")
	}
	right := mutedStyle.Render(truncateWidth(m.client.BaseURL()+"  "+state, max(0, width-lipgloss.Width(title)-2)))
	gap := strings.Repeat(" ", max(1, width-lipgloss.Width(title)-lipgloss.Width(right)))
	return title + gap + right
}

func (m Model) renderSummary(width int) string {
	summary := m.data.Summary
	balances := make([]string, 0, 2)
	if value := summary.BalanceByCurrency["CNY"]; value != 0 {
		balances = append(balances, fmt.Sprintf("¥%.2f", value))
	}
	if value := summary.BalanceByCurrency["USD"]; value != 0 {
		balances = append(balances, fmt.Sprintf("$%.2f", value))
	}
	balanceText := ""
	if len(balances) > 0 {
		balanceText = "  余额合计 " + strings.Join(balances, " / ")
	}
	text := fmt.Sprintf(
		"账号 %d  %s正常 %d  %s警告 %d  %s错误 %d%s",
		summary.Total,
		statusStyle("ok").Render("● "), summary.OK,
		statusStyle("warn").Render("● "), summary.Warn,
		statusStyle("error").Render("● "), summary.Error,
		balanceText,
	)
	return truncateWidth(text, width)
}

func (m Model) renderList(width int) string {
	// Keep two spare columns because some Windows terminals render the status
	// bullet wider than its wcwidth value.
	innerWidth := max(18, width-6)
	rows := []string{titleStyle.Render("账号")}
	for index, account := range m.data.Accounts {
		marker := "  "
		style := lipgloss.NewStyle()
		if index == m.cursor {
			marker = "› "
			style = selectedStyle
		}
		status := statusStyle(account.Status).Render("●")
		nameWidth := max(8, innerWidth-16)
		name := truncateWidth(account.Label, nameWidth)
		value := accountPrimaryValue(account)
		line := fmt.Sprintf("%s%s %s", marker, status, name)
		gap := strings.Repeat(" ", max(1, innerWidth-lipgloss.Width(line)-lipgloss.Width(value)))
		rows = append(rows, style.Render(line+gap+value))
		vendor := mutedStyle.Render("    " + truncateWidth(account.VendorName, max(8, innerWidth-4)))
		rows = append(rows, vendor)
	}
	return panelStyle.Width(max(20, width-4)).Render(strings.Join(rows, "\n"))
}

func (m Model) renderDetail(width int) string {
	if len(m.data.Accounts) == 0 {
		return ""
	}
	account := m.data.Accounts[m.cursor]
	innerWidth := max(20, width-4)
	lines := []string{
		titleStyle.Render(truncateWidth(account.Label, innerWidth)),
		mutedStyle.Render(truncateWidth(account.VendorName+optionalSeparator(account.Plan), innerWidth)),
	}
	if account.AccountName != "" {
		lines = append(lines, "账号  "+truncateWidth(account.AccountName, max(8, innerWidth-6)))
	}
	if account.SubscriptionExpiresAt != "" {
		lines = append(lines, "到期  "+account.SubscriptionExpiresAt)
	}
	if account.Balance != nil {
		lines = append(lines, "", "余额  "+selectedStyle.Render(formatBalance(*account.Balance)))
		if account.Balance.Granted != nil {
			lines = append(lines, mutedStyle.Render(fmt.Sprintf("赠送余额 %.2f", *account.Balance.Granted)))
		}
	}
	if len(account.Windows) > 0 {
		lines = append(lines, "", "配额窗口")
		for _, window := range account.Windows {
			label := window.Label
			if window.Group != "" {
				label = window.Group + " · " + label
			}
			value := fmt.Sprintf("%.0f%%", window.UsedPercent)
			if window.Value != "" {
				value = window.Value
			}
			lines = append(lines, truncateWidth(label, innerWidth))
			barWidth := max(8, min(24, innerWidth-lipgloss.Width(value)-2))
			lines = append(lines, progressBar(window.UsedPercent, barWidth)+"  "+value)
			meta := strings.TrimSpace(strings.Join(nonEmpty(window.ResetIn, window.Detail), " · "))
			if meta != "" {
				lines = append(lines, mutedStyle.Render(truncateWidth(meta, innerWidth)))
			}
		}
	}
	if account.Note != "" {
		lines = append(lines, "", statusStyle(account.Status).Render(truncateWidth(account.Note, innerWidth)))
	}
	if account.LastFetched > 0 {
		lines = append(lines, "", mutedStyle.Render("服务端刷新 "+time.UnixMilli(account.LastFetched).Format("2006-01-02 15:04:05")))
	}
	return panelStyle.Width(max(20, width-4)).Render(strings.Join(lines, "\n"))
}

func (m Model) renderFooter(width int) string {
	interval := "自动刷新已关闭"
	if m.refreshInterval > 0 {
		interval = "每 " + m.refreshInterval.String() + " 自动刷新"
	}
	help := helpKeyStyle.Render("↑/↓ j/k") + " 选择  " + helpKeyStyle.Render("r") + " 刷新  " + helpKeyStyle.Render("q") + " 退出"
	gap := strings.Repeat(" ", max(1, width-lipgloss.Width(help)-lipgloss.Width(interval)))
	return mutedStyle.Render(help + gap + interval)
}

func accountPrimaryValue(account api.Account) string {
	if account.Balance != nil {
		return formatBalance(*account.Balance)
	}
	if len(account.Windows) > 0 {
		worst := account.Windows[0].UsedPercent
		for _, window := range account.Windows[1:] {
			worst = math.Max(worst, window.UsedPercent)
		}
		return fmt.Sprintf("%.0f%%", worst)
	}
	return "--"
}

func formatBalance(balance api.Balance) string {
	symbol := balance.Currency + " "
	if balance.Currency == "CNY" {
		symbol = "¥"
	} else if balance.Currency == "USD" {
		symbol = "$"
	}
	return fmt.Sprintf("%s%.2f", symbol, balance.Amount)
}

func progressBar(percent float64, width int) string {
	percent = math.Max(0, math.Min(100, percent))
	filled := int(math.Round(percent / 100 * float64(width)))
	color := colorOK
	if percent >= 90 {
		color = colorError
	} else if percent >= 80 {
		color = colorWarn
	}
	return lipgloss.NewStyle().Foreground(color).Render(strings.Repeat("█", filled)) +
		lipgloss.NewStyle().Foreground(colorBorder).Render(strings.Repeat("░", width-filled))
}

func optionalSeparator(value string) string {
	if value == "" {
		return ""
	}
	return " · " + value
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func truncateWidth(value string, width int) string {
	if width <= 0 {
		return ""
	}
	if lipgloss.Width(value) <= width {
		return value
	}
	if width == 1 {
		return "…"
	}
	var result strings.Builder
	for _, char := range value {
		candidate := result.String() + string(char)
		if lipgloss.Width(candidate)+1 > width {
			break
		}
		result.WriteRune(char)
	}
	return result.String() + "…"
}
