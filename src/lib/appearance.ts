/**
 * 外观设置：配色主题 + 自定义背景图
 * - 配色经 html[data-theme] 切换 CSS 变量，明暗模式（.dark）相互独立
 * - 背景图经 html 上的 --bg-image/--bg-opacity/--bg-blur 注入 body::before 图层
 * - 首屏防闪烁由 layout.tsx 内联脚本负责，这里只处理交互后的应用与持久化
 */

export const LS_COLOR_THEME = "ai-usage-color-theme"
export const LS_BG = "ai-usage-bg"

export interface ColorTheme {
  id: string
  name: string
  en: string
  /** 预览三色：背景 / 前景 / 点缀，分明暗两套 */
  swatch: { light: [string, string, string]; dark: [string, string, string] }
}

export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "swiss",
    name: "瑞士红",
    en: "Swiss Red",
    swatch: { light: ["#fafaf7", "#141412", "#e30613"], dark: ["#171715", "#d3d3cd", "#ff3b30"] },
  },
  {
    id: "klein",
    name: "克莱因蓝",
    en: "Klein Blue",
    swatch: { light: ["#e9eef7", "#10203f", "#002fa7"], dark: ["#0a1120", "#bcccec", "#5c8aff"] },
  },
  {
    id: "racing",
    name: "英伦绿",
    en: "Racing Green",
    swatch: { light: ["#e9efe7", "#12271a", "#00563f"], dark: ["#0a1a10", "#bfe0c6", "#46c787"] },
  },
  {
    id: "ember",
    name: "赤橙",
    en: "Ember",
    swatch: { light: ["#f8ecdc", "#2a1a0c", "#c2410c"], dark: ["#1d1108", "#ecd5b6", "#fb8c2e"] },
  },
  {
    id: "morandi",
    name: "莫兰迪",
    en: "Morandi",
    swatch: { light: ["#e6e2d8", "#3f3a30", "#5a6e7f"], dark: ["#211e19", "#d0c9b6", "#a3bccb"] },
  },
  {
    id: "violet",
    name: "檀紫",
    en: "Sandalwood",
    swatch: { light: ["#efe9f6", "#241335", "#6b4e92"], dark: ["#150c22", "#d3c4ec", "#bd97e8"] },
  },
]

export interface BackgroundConfig {
  src: string
  /** 0.05 – 0.6 */
  opacity: number
  /** 0 – 20 (px) */
  blur: number
}

export const BG_DEFAULTS = { opacity: 0.18, blur: 0 } as const

/** 剥离会破坏 CSS url("…") 语法的字符 */
function sanitizeUrl(url: string): string {
  return url.replace(/["\\\n\r]/g, "").trim()
}

export function readColorTheme(): string {
  try {
    return localStorage.getItem(LS_COLOR_THEME) || "swiss"
  } catch {
    return "swiss"
  }
}

export function applyColorTheme(id: string) {
  if (id === "swiss") {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = id
  }
  try {
    localStorage.setItem(LS_COLOR_THEME, id)
  } catch {
    // 隐私模式等：仅本次生效
  }
}

export function readBackground(): BackgroundConfig | null {
  try {
    const raw = localStorage.getItem(LS_BG)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BackgroundConfig>
    if (!parsed.src || typeof parsed.src !== "string") return null
    return {
      src: parsed.src,
      opacity: typeof parsed.opacity === "number" ? parsed.opacity : BG_DEFAULTS.opacity,
      blur: typeof parsed.blur === "number" ? parsed.blur : BG_DEFAULTS.blur,
    }
  } catch {
    return null
  }
}

export function applyBackground(cfg: BackgroundConfig | null) {
  const root = document.documentElement
  if (!cfg) {
    delete root.dataset.hasBg
    root.style.removeProperty("--bg-image")
    root.style.removeProperty("--bg-opacity")
    root.style.removeProperty("--bg-blur")
  } else {
    root.dataset.hasBg = "true"
    root.style.setProperty("--bg-image", `url("${sanitizeUrl(cfg.src)}")`)
    root.style.setProperty("--bg-opacity", String(cfg.opacity))
    root.style.setProperty("--bg-blur", `${cfg.blur}px`)
  }
  try {
    if (cfg) localStorage.setItem(LS_BG, JSON.stringify(cfg))
    else localStorage.removeItem(LS_BG)
  } catch {
    // 存储失败（超限等）时本次仍生效，由调用方提示
  }
}

/** localStorage 约 5MB 上限，dataURL 控制在 4M 字符内 */
const MAX_DATA_URL_LEN = 4_000_000

/** 本地图片 → 压缩后的 JPEG dataURL（最长边 1920，逐级降质直至可存储） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("读取文件失败"))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("图片解析失败"))
      img.onload = () => {
        const MAX_SIDE = 1920
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("当前浏览器不支持图片处理"))
          return
        }
        // JPEG 无透明通道，先铺白底避免透明区域变黑
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        for (const q of [0.85, 0.7, 0.55, 0.4]) {
          const url = canvas.toDataURL("image/jpeg", q)
          if (url.length <= MAX_DATA_URL_LEN) {
            resolve(url)
            return
          }
        }
        reject(new Error("图片体积过大，请压缩后重试或改用图片链接"))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
