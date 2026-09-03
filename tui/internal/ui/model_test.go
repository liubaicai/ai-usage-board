package ui

import (
	"strings"
	"testing"

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

func TestRenderHidesNormalProviderNotesButKeepsErrors(t *testing.T) {
	model := Model{}
	normal := api.Account{
		VendorID:   "antigravity",
		VendorName: "Antigravity",
		Label:      "Antigravity",
		Status:     "ok",
		Note:       "Gemini 组配额",
	}
	if card := model.renderCard(normal, 38, false); strings.Contains(card, "Gemini 组配额") {
		t.Fatalf("normal informational note should be hidden: %q", card)
	}
	errorAccount := normal
	errorAccount.Status = "error"
	errorAccount.Note = "拉取失败"
	if card := model.renderCard(errorAccount, 38, false); !strings.Contains(card, "拉取失败") {
		t.Fatalf("error note should remain visible: %q", card)
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
