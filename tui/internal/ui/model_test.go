package ui

import (
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

func TestRenderQuotaCardKeepsFixedGridSize(t *testing.T) {
	account := api.Account{
		Label:      "A very long subscription account name",
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
	card := (Model{}).renderCard(account, 38, true)
	if got := lipgloss.Width(card); got != 38 {
		t.Fatalf("card width = %d, want 38", got)
	}
	if got := lipgloss.Height(card); got != cardContentHeight+2 {
		t.Fatalf("card height = %d, want %d", got, cardContentHeight+2)
	}
}
