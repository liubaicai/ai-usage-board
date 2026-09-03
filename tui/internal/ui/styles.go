package ui

import "github.com/charmbracelet/lipgloss"

var (
	colorAccent  = lipgloss.AdaptiveColor{Light: "#6D28D9", Dark: "#A78BFA"}
	colorMuted   = lipgloss.AdaptiveColor{Light: "#64748B", Dark: "#94A3B8"}
	colorBorder  = lipgloss.AdaptiveColor{Light: "#CBD5E1", Dark: "#334155"}
	colorOK      = lipgloss.AdaptiveColor{Light: "#15803D", Dark: "#4ADE80"}
	colorWarn    = lipgloss.AdaptiveColor{Light: "#B45309", Dark: "#FBBF24"}
	colorError   = lipgloss.AdaptiveColor{Light: "#B91C1C", Dark: "#F87171"}
	colorSurface = lipgloss.AdaptiveColor{Light: "#F8FAFC", Dark: "#111827"}

	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(colorAccent)
	mutedStyle = lipgloss.NewStyle().Foreground(colorMuted)
	panelStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colorBorder).
			Padding(0, 1)
	errorStyle   = lipgloss.NewStyle().Foreground(colorError)
	helpKeyStyle = lipgloss.NewStyle().Bold(true).Foreground(colorMuted)
)

func statusStyle(status string) lipgloss.Style {
	switch status {
	case "ok":
		return lipgloss.NewStyle().Foreground(colorOK)
	case "warn":
		return lipgloss.NewStyle().Foreground(colorWarn)
	default:
		return lipgloss.NewStyle().Foreground(colorError)
	}
}
