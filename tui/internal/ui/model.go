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
		columns := gridColumns(max(30, m.width-2))
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "r":
			if !m.loading {
				return m.startFetch(true)
			}
		case "left", "h":
			m.cursor = max(0, m.cursor-1)
		case "right", "l":
			m.cursor = min(max(0, len(m.data.Accounts)-1), m.cursor+1)
		case "up", "k":
			m.cursor = max(0, m.cursor-columns)
		case "down", "j":
			m.cursor = min(max(0, len(m.data.Accounts)-1), m.cursor+columns)
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
	} else {
		body = m.renderGrid(contentWidth)
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

func (m Model) renderGrid(width int) string {
	const columnGap = 2
	const rowGap = 1

	columns := gridColumns(width)
	cardWidth := (width - columnGap*(columns-1)) / columns
	totalRows := (len(m.data.Accounts) + columns - 1) / columns
	selectedRow := m.cursor / columns
	reservedHeight := 6
	if m.err != nil {
		reservedHeight += 2
	}
	availableHeight := max(1, m.height-reservedHeight)

	rows := make([]string, 0, totalRows)
	rowHeights := make([]int, 0, totalRows)
	for row := 0; row < totalRows; row++ {
		cards := make([]string, 0, columns)
		for column := 0; column < columns; column++ {
			index := row*columns + column
			if index >= len(m.data.Accounts) {
				break
			}
			cards = append(cards, m.renderCard(m.data.Accounts[index], cardWidth, index == m.cursor))
		}
		renderedRow := lipgloss.JoinHorizontal(lipgloss.Top, intersperse(cards, strings.Repeat(" ", columnGap))...)
		rows = append(rows, renderedRow)
		rowHeights = append(rowHeights, lipgloss.Height(renderedRow))
	}
	startRow, endRow := visibleRowRange(rowHeights, selectedRow, availableHeight, rowGap)
	return strings.Join(rows[startRow:endRow], strings.Repeat("\n", rowGap+1))
}

func (m Model) renderCard(account api.Account, width int, selected bool) string {
	innerWidth := max(18, width-6)
	nameStyle := lipgloss.NewStyle().Bold(true)
	if selected {
		nameStyle = nameStyle.Foreground(colorAccent)
	}
	headerRight := truncateWidth(strings.ToUpper(account.Plan), max(0, innerWidth/3))
	nameWidth := max(5, innerWidth-lipgloss.Width(headerRight)-4)
	headerLeft := statusStyle(account.Status).Render("■") + " " + nameStyle.Render(truncateWidth(account.Label, nameWidth))
	lines := []string{alignLine(headerLeft, headerRight, innerWidth)}

	meta := account.VendorName
	if account.AccountName != "" {
		meta += " · " + account.AccountName
	} else if account.SubscriptionExpiresAt != "" {
		meta += " · 到期 " + account.SubscriptionExpiresAt
	}
	lines = append(lines, mutedStyle.Render(truncateWidth(meta, innerWidth)), "")

	if account.Balance != nil {
		lines = append(lines, mutedStyle.Render("当前余额"))
		lines = append(lines, lipgloss.NewStyle().Bold(true).Foreground(colorAccent).Render(formatBalance(*account.Balance)))
		details := make([]string, 0, 2)
		if account.Balance.Granted != nil {
			details = append(details, fmt.Sprintf("赠送 %.2f", *account.Balance.Granted))
		}
		if account.Balance.TotalBalance != nil && math.Abs(*account.Balance.TotalBalance-account.Balance.Amount) > 0.005 {
			details = append(details, fmt.Sprintf("总额 %.2f", *account.Balance.TotalBalance))
		}
		if len(details) > 0 {
			lines = append(lines, mutedStyle.Render(truncateWidth(strings.Join(details, " · "), innerWidth)))
		}
	} else {
		windows := displayWindows(account)
		for _, window := range windows {
			label := window.Label
			if window.Group != "" {
				label = window.Group + " · " + label
			}
			reset := window.ResetIn
			if reset != "" {
				reset = "重置 " + reset
			}
			label = truncateWidth(label, max(8, innerWidth/2))
			reset = truncateWidth(reset, max(0, innerWidth-lipgloss.Width(label)-1))
			lines = append(lines, alignLine(label, mutedStyle.Render(reset), innerWidth))
			if !windowAvailable(window) {
				lines = append(lines, mutedStyle.Render("—")+" "+progressBar(0, max(6, innerWidth-3)))
				continue
			}
			value := fmt.Sprintf("%.0f%%", window.UsedPercent)
			if window.Value != "" {
				value = window.Value
			}
			barWidth := max(6, innerWidth-lipgloss.Width(value)-2)
			lines = append(lines, statusStyle(statusForPercent(window.UsedPercent)).Render(truncateWidth(value, max(5, innerWidth/3)))+" "+progressBar(window.UsedPercent, barWidth))
		}
	}

	note := ""
	if account.Status != "ok" {
		note = strings.TrimSpace(account.Note)
	}
	if note != "" {
		lines = append(lines, statusStyle(account.Status).Render(truncateWidth(note, innerWidth)))
	}
	updated := "尚未刷新"
	if account.LastFetched > 0 {
		updated = "刷新 " + time.UnixMilli(account.LastFetched).Format("01-02 15:04:05")
	}
	lines = append(lines, mutedStyle.Render(updated))

	borderColor := colorBorder
	if account.Status == "error" {
		borderColor = colorError
	} else if account.Status == "warn" {
		borderColor = colorWarn
	}
	if selected {
		borderColor = colorAccent
	}
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Background(colorSurface).
		Padding(0, 1).
		Width(max(20, width-2)).
		Render(strings.Join(lines, "\n"))
}

func (m Model) renderFooter(width int) string {
	interval := "自动刷新已关闭"
	if m.refreshInterval > 0 {
		interval = "每 " + m.refreshInterval.String() + " 自动刷新"
	}
	help := helpKeyStyle.Render("方向键/hjkl") + " 浏览卡片  " + helpKeyStyle.Render("r") + " 刷新  " + helpKeyStyle.Render("q") + " 退出"
	if len(m.data.Accounts) > 0 {
		help += mutedStyle.Render(fmt.Sprintf("  %d/%d", m.cursor+1, len(m.data.Accounts)))
	}
	gap := strings.Repeat(" ", max(1, width-lipgloss.Width(help)-lipgloss.Width(interval)))
	return mutedStyle.Render(help + gap + interval)
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

func gridColumns(width int) int {
	switch {
	case width >= 154:
		return 4
	case width >= 114:
		return 3
	case width >= 76:
		return 2
	default:
		return 1
	}
}

func visibleRowRange(heights []int, selected, availableHeight, gap int) (int, int) {
	if len(heights) == 0 {
		return 0, 0
	}
	selected = max(0, min(selected, len(heights)-1))
	start := selected
	used := heights[selected]
	for start > 0 {
		candidate := heights[start-1] + gap + used
		if candidate > availableHeight {
			break
		}
		start--
		used = candidate
	}

	end := start
	used = 0
	for end < len(heights) {
		next := heights[end]
		if end > start {
			next += gap
		}
		if end > start && used+next > availableHeight {
			break
		}
		used += next
		end++
	}
	return start, end
}

func windowAvailable(window api.QuotaWindow) bool {
	return window.Available == nil || *window.Available
}

func displayWindows(account api.Account) []api.QuotaWindow {
	if account.VendorID != "codex" {
		return account.Windows
	}

	templates := []api.QuotaWindow{
		{ID: "codex-5h", Label: "5 小时限额"},
		{ID: "codex-weekly", Label: "每周限额"},
	}
	matched := make([]bool, len(account.Windows))
	result := make([]api.QuotaWindow, 0, len(account.Windows)+len(templates))
	for _, template := range templates {
		found := -1
		for index, window := range account.Windows {
			if window.ID == template.ID || window.Label == template.Label {
				found = index
				break
			}
		}
		if found >= 0 {
			matched[found] = true
			result = append(result, account.Windows[found])
			continue
		}
		available := false
		template.Available = &available
		result = append(result, template)
	}
	for index, window := range account.Windows {
		if !matched[index] {
			result = append(result, window)
		}
	}
	return result
}

func statusForPercent(percent float64) string {
	if percent >= 90 {
		return "error"
	}
	if percent >= 80 {
		return "warn"
	}
	return "ok"
}

func alignLine(left, right string, width int) string {
	rightWidth := lipgloss.Width(right)
	gap := strings.Repeat(" ", max(1, width-lipgloss.Width(left)-rightWidth))
	return left + gap + right
}

func intersperse(values []string, separator string) []string {
	if len(values) < 2 {
		return values
	}
	result := make([]string, 0, len(values)*2-1)
	for index, value := range values {
		if index > 0 {
			result = append(result, separator)
		}
		result = append(result, value)
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
