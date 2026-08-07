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

/** 首屏前读取本地主题偏好，避免闪烁 */
const themeScript = `
;(function () {
  try {
    var stored = localStorage.getItem("ai-usage-theme")
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    if (stored === "dark" || (!stored && prefersDark)) {
      document.documentElement.classList.add("dark")
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
