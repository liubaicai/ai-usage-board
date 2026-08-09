"use client"

import { useEffect, useRef, useState } from "react"
import { ImagePlus, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  BG_DEFAULTS,
  COLOR_THEMES,
  applyBackground,
  applyColorTheme,
  fileToDataUrl,
  readBackground,
  readColorTheme,
  type BackgroundConfig,
} from "@/lib/appearance"

const inputCls =
  "w-full border border-border bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground"
const labelCls =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"

interface ThemeSettingsProps {
  open: boolean
  dark: boolean
  onClose: () => void
}

export function ThemeSettings({ open, dark, onClose }: ThemeSettingsProps) {
  const [themeId, setThemeId] = useState("swiss")
  const [bg, setBg] = useState<BackgroundConfig | null>(null)
  const [url, setUrl] = useState("")
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  // 首屏视觉由内联脚本恢复，这里仅同步面板 UI 状态
  useEffect(() => {
    setThemeId(readColorTheme())
    setBg(readBackground())
  }, [])

  // Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  const pickTheme = (id: string) => {
    setThemeId(id)
    applyColorTheme(id)
  }

  const setBackground = (cfg: BackgroundConfig | null) => {
    setBg(cfg)
    applyBackground(cfg)
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setError("")
    try {
      const src = await fileToDataUrl(file)
      setBackground({
        src,
        opacity: bg?.opacity ?? BG_DEFAULTS.opacity,
        blur: bg?.blur ?? BG_DEFAULTS.blur,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "图片处理失败")
    }
  }

  const handleApplyUrl = () => {
    const src = url.trim()
    if (!src) return
    setError("")
    setBackground({
      src,
      opacity: bg?.opacity ?? BG_DEFAULTS.opacity,
      blur: bg?.blur ?? BG_DEFAULTS.blur,
    })
    setUrl("")
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="外观设置">
      <div className="backdrop-enter absolute inset-0 bg-black/45" onClick={onClose} />
      <aside className="panel-enter absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-border bg-background">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">外观设置</h2>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Appearance
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* 配色主题 */}
          <section>
            <span className={labelCls}>配色主题 · Color Theme</span>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_THEMES.map((t) => {
                const active = t.id === themeId
                const [swBg, swFg, swAccent] = dark ? t.swatch.dark : t.swatch.light
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickTheme(t.id)}
                    className={cn(
                      "border p-2 text-left transition-colors",
                      active ? "border-accent" : "border-border hover:border-foreground"
                    )}
                  >
                    <span
                      className="block h-14 w-full border border-border/50 p-1.5"
                      style={{ background: swBg }}
                    >
                      <span className="block h-1.5 w-1.5" style={{ background: swAccent }} />
                      <span className="mt-1.5 block h-px w-3/4" style={{ background: swFg }} />
                      <span
                        className="mt-1 block h-px w-1/2"
                        style={{ background: swFg, opacity: 0.45 }}
                      />
                    </span>
                    <span className="mt-2 flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        {active && <span className="block h-2 w-2 bg-accent" aria-hidden />}
                        {t.name}
                      </span>
                      <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                        {t.en}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] tracking-[0.08em] text-muted-foreground">
              配色同时适配明暗两种模式，可与右上角明暗开关自由组合
            </p>
          </section>

          {/* 背景图片 */}
          <section className="mt-7 border-t border-border pt-5">
            <span className={labelCls}>背景图片 · Background</span>

            {bg && (
              <div className="mb-3 border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bg.src}
                  alt="当前背景预览"
                  className="h-24 w-full object-cover"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                上传图片
              </Button>
              {bg && (
                <Button variant="outline" size="sm" onClick={() => setBackground(null)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  移除
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ""
              }}
            />

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                className={cn(inputCls, "flex-1")}
                placeholder="或粘贴图片链接，回车应用"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyUrl()
                }}
                spellCheck={false}
              />
              <Button variant="outline" size="sm" className="self-center" onClick={handleApplyUrl}>
                应用
              </Button>
            </div>

            {error && <p className="mt-2 text-[11px] text-accent">{error}</p>}

            {bg && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <span>不透明度</span>
                    <span className="tabular-nums">{Math.round(bg.opacity * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={Math.round(bg.opacity * 100)}
                    onChange={(e) =>
                      setBackground({ ...bg, opacity: Number(e.target.value) / 100 })
                    }
                    className="w-full [accent-color:var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <span>模糊</span>
                    <span className="tabular-nums">{bg.blur}px</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={bg.blur}
                    onChange={(e) => setBackground({ ...bg, blur: Number(e.target.value) })}
                    className="w-full [accent-color:var(--accent)]"
                  />
                </label>
              </div>
            )}
          </section>
        </div>

        <footer className="border-t border-border px-5 py-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          保存在本地浏览器 · 即时生效
        </footer>
      </aside>
    </div>
  )
}
