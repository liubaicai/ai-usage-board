import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "能量条 Energy Bar — AI 订阅用量与余额总览",
  description: "多厂商 AI 订阅用量与余额总览：Codex / Claude Code / GLM / Kimi / DeepSeek 等，支持多账号、定时刷新、拖拽排序。",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

/** 首屏前读取本地外观偏好（明暗 / 配色主题 / 背景图），避免闪烁 */
const themeScript = `
;(function () {
  try {
    var root = document.documentElement
    var stored = localStorage.getItem("ai-usage-theme")
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    if (stored === "dark" || (!stored && prefersDark)) {
      root.classList.add("dark")
    }
    var colorTheme = localStorage.getItem("ai-usage-color-theme")
    if (colorTheme && colorTheme !== "swiss") {
      root.dataset.theme = colorTheme
    }
    var bgRaw = localStorage.getItem("ai-usage-bg")
    if (bgRaw) {
      var bg = JSON.parse(bgRaw)
      if (bg && typeof bg.src === "string" && bg.src) {
        root.dataset.hasBg = "true"
        var src = bg.src.replace(/["\\\\\\n\\r]/g, "")
        root.style.setProperty("--bg-image", 'url("' + src + '")')
        root.style.setProperty("--bg-opacity", String(typeof bg.opacity === "number" ? bg.opacity : 0.18))
        root.style.setProperty("--bg-blur", (typeof bg.blur === "number" ? bg.blur : 0) + "px")
      }
    }
  } catch (e) {}
})()
`

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
