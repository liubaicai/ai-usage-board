package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/liubaicai/ai-usage-board/tui/internal/api"
)

func TestGridColumns(t *testing.T) {
	tests := []struct {
		width int
		want  int
	}{
		{width: 60, want: 1},
		{width: 76, want: 2},
		{width: 114, want: 3},
		{width: 154, want: 4},
	}
	for _, test := range tests {
		if got := gridColumns(test.width); got != test.want {
			t.Fatalf("gridColumns(%d) = %d, want %d", test.width, got, test.want)
		}
	}
}

func TestStatusForPercent(t *testing.T) {
	if got := statusForPercent(79); got != "ok" {
		t.Fatalf("statusForPercent(79) = %q", got)
	}
	if got := statusForPercent(80); got != "warn" {
		t.Fatalf("statusForPercent(80) = %q", got)
	}
	if got := statusForPercent(90); got != "error" {
		t.Fatalf("statusForPercent(90) = %q", got)
	}
}

func TestRenderCardsUseContentHeight(t *testing.T) {
	quotaAccount := api.Account{
		Label:      "A very long subscription account name",
		VendorID:   "codex",
		VendorName: "Codex",
		Status:     "warn",
		Note:       "配额接近上限",
		Windows: []api.QuotaWindow{
			{Label: "5 小时限额", UsedPercent: 25, ResetIn: "2 小时"},
			{Label: "每周限额", UsedPercent: 80, ResetIn: "5 天"},
			{Label: "每月限额", UsedPercent: 90, ResetIn: "20 天"},
			{Label: "代码审查限额", UsedPercent: 50, ResetIn: "1 天"},
		},
	}
	balanceAccount := api.Account{
		Label:      "DeepSeek",
		VendorName: "DeepSeek",
		Status:     "ok",
		Balance:    &api.Balance{Amount: 12.34, Currency: "CNY"},
	}
	quotaCard := (Model{}).renderCard(quotaAccount, 38, true)
	balanceCard := (Model{}).renderCard(balanceAccount, 38, false)
	if got := lipgloss.Width(quotaCard); got != 38 {
		t.Fatalf("card width = %d, want 38", got)
	}
	if lipgloss.Height(quotaCard) <= lipgloss.Height(balanceCard) {
		t.Fatalf("quota card height %d should exceed balance card height %d", lipgloss.Height(quotaCard), lipgloss.Height(balanceCard))
	}
}

func TestRenderCodexAddsPlaceholderAndHidesInformationalNote(t *testing.T) {
	account := api.Account{
		VendorID:   "codex",
		VendorName: "Codex",
		Label:      "Codex",
		Status:     "ok",
		Note:       "免费档（无付费积分）",
		Windows: []api.QuotaWindow{
			{Label: "每周限额", UsedPercent: 20},
		},
	}
	card := (Model{}).renderCard(account, 38, false)
	if !strings.Contains(card, "5 小时限额") || !strings.Contains(card, "—") {
		t.Fatalf("placeholder window was not rendered: %q", card)
	}
	if strings.Contains(card, "无付费积分") {
		t.Fatalf("free credit note should be hidden: %q", card)
	}
}

func TestRenderNeverShowsProviderNotes(t *testing.T) {
	model := Model{}
	account := api.Account{
		VendorID:   "antigravity",
		VendorName: "Antigravity",
		Label:      "Antigravity",
		Status:     "error",
		Note:       "套餐 pro · MCP 月度配额见控制台",
	}
	for _, status := range []string{"ok", "warn", "error"} {
		account.Status = status
		if card := model.renderCard(account, 38, false); strings.Contains(card, "MCP 月度配额") {
			t.Fatalf("note should never be rendered (status=%s): %q", status, card)
		}
	}
}

func TestVisibleRowRangeUsesAdaptiveHeights(t *testing.T) {
	start, end := visibleRowRange([]int{7, 15, 8}, 1, 23, 1)
	if start != 0 || end != 2 {
		t.Fatalf("visibleRowRange = (%d, %d), want (0, 2)", start, end)
	}
	start, end = visibleRowRange([]int{7, 15, 8}, 2, 23, 1)
	if start != 2 || end != 3 {
		t.Fatalf("visibleRowRange = (%d, %d), want (2, 3)", start, end)
	}
}

func TestEnterRefreshesSelectedAccount(t *testing.T) {
	model := Model{
		data: api.UsageResponse{Accounts: []api.Account{
			{ID: "acc-1", Label: "A"},
			{ID: "acc-2", Label: "B"},
		}},
		cursor: 1,
	}

	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	next := updated.(Model)
	if !next.loading {
		t.Fatal("enter should put the model into loading state")
	}
	if cmd == nil {
		t.Fatal("enter should return a command that refreshes the selected account")
	}
}

func TestEnterIgnoredWhenLoading(t *testing.T) {
	model := Model{
		data: api.UsageResponse{Accounts: []api.Account{
			{ID: "acc-1", Label: "A"},
		}},
		cursor: 0,
		loading: true,
	}
	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	next := updated.(Model)
	if next.loading != true || cmd != nil {
		t.Fatal("enter while loading should be ignored")
	}
}

func TestEnterIgnoredWithoutAccounts(t *testing.T) {
	model := Model{data: api.UsageResponse{}}
	updated, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil {
		t.Fatal("enter with no accounts should be ignored")
	}
	if updated.(Model).loading {
		t.Fatal("no accounts: enter must not trigger loading")
	}
}

func TestRenderCardPadsContentToMinimumHeight(t *testing.T) {
	balanceOnly := api.Account{
		Label:   "DeepSeek",
		Status:  "ok",
		Balance: &api.Balance{Amount: 12.34, Currency: "CNY"},
	}
	card := (Model{}).renderCard(balanceOnly, 38, false)
	// header(1)+meta(1)+blank(1)+min content(4)+updated(1) = 8 行
	if got := strings.Count(card, "\n") + 1; got < 8 {
		t.Fatalf("balance card rendered %d lines, want >= 8 (min content pad)", got)
	}

	// 多 window 卡片不应被额外填充：仅需 > min-height
	quota := api.Account{
		Label:    "WorkBuddy",
		Status:   "warn",
		Windows:  []api.QuotaWindow{
			{Label: "基础", UsedPercent: 0, ResetIn: "20d 22h"},
			{Label: "活动", UsedPercent: 50, ResetIn: "30d 7h"},
		},
	}
	quotaCard := (Model{}).renderCard(quota, 38, false)
	quotaLines := strings.Count(quotaCard, "\n") + 1
	if quotaLines < 9 { // 2 windows × 2 + 5 fixed = 9
		t.Fatalf("quota card rendered %d lines, want >= 9", quotaLines)
	}
}

func TestRenderFooterMentionsPerCardRefresh(t *testing.T) {
	footer := (Model{refreshInterval: 5 * time.Minute, data: api.UsageResponse{Accounts: []api.Account{{ID: "a", Label: "A"}}}}).renderFooter(120)
	if !strings.Contains(footer, "刷新选中") {
		t.Fatalf("footer should mention per-card refresh: %q", footer)
	}
}
