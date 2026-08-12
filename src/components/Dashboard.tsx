"use client"

import { useEffect, useRef, useState } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable"
import { Maximize, Minimize, Moon, Plus, RefreshCw, Settings, Sun } from "lucide-react"
import NoSleep from "nosleep.js"

import { AccountDialog } from "@/components/AccountDialog"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { ProviderCard } from "@/components/ProviderCard"
import { ThemeSettings } from "@/components/ThemeSettings"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { VENDOR_MAP } from "@/vendors"
import { apiClient } from "@/lib/client-api"
import { applyColorTheme, readColorTheme } from "@/lib/appearance"
import {
  REFRESH_OPTIONS,
  formatTime,
  type Account,
  type AccountInput,
} from "@/lib/types"

const LS_THEME = "ai-usage-theme"

function useTheme() {
  const [dark, setDark] = useState(false)
  // 用 ref 保存最新值，避免闭包过期
  const darkRef = useRef(false)
  useEffect(() => {
    // 从 localStorage 读取而非 DOM class —— React 水合可能重置 inline 脚本设置的 class
    let initial: boolean
    try {
      const stored = localStorage.getItem(LS_THEME)
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      initial = stored === "dark" || (!stored && prefersDark)
    } catch {
      initial = document.documentElement.classList.contains("dark")
    }
    darkRef.current = initial
    setDark(initial)
    document.documentElement.classList.toggle("dark", initial)
  }, [])
  /** 切换并持久化：写 DOM 类 + localStorage 只在此处发生，避免挂载时用初始 false 覆盖存储 */
  const apply = (next: boolean) => {
    darkRef.current = next
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    try {
      localStorage.setItem(LS_THEME, next ? "dark" : "light")
    } catch {
      // localStorage 不可用（隐私模式等）：本次切换仍生效，仅刷新后回退系统偏好
    }
  }
  return { dark, toggle: () => apply(!darkRef.current) }
}

function useFullscreen(targetRef: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const noSleepRef = useRef<NoSleep | null>(null)

  useEffect(() => {
    let disposed = false
    let wakeLockPending = false

    const releaseWakeLock = () => {
      const wakeLock = wakeLockRef.current
      wakeLockRef.current = null
      if (wakeLock && !wakeLock.released) {
        void wakeLock.release().catch(() => {})
      }
    }

    const disableNoSleep = () => {
      if (noSleepRef.current?.isEnabled) noSleepRef.current.disable()
    }

    const requestWakeLock = async () => {
      if (
        disposed ||
        wakeLockPending ||
        wakeLockRef.current ||
        document.fullscreenElement !== targetRef.current ||
        document.visibilityState !== "visible" ||
        !window.isSecureContext ||
        !("wakeLock" in navigator)
      ) {
        return
      }

      wakeLockPending = true
      try {
        const wakeLock = await navigator.wakeLock.request("screen")
        if (
          disposed ||
          document.fullscreenElement !== targetRef.current ||
          document.visibilityState !== "visible"
        ) {
          void wakeLock.release().catch(() => {})
          return
        }

        wakeLockRef.current = wakeLock
        wakeLock.addEventListener(
          "release",
          () => {
            if (wakeLockRef.current === wakeLock) wakeLockRef.current = null
          },
          { once: true }
        )
      } catch {
        // 浏览器可能因省电策略拒绝原生唤醒锁；全屏功能仍正常可用。
      } finally {
        wakeLockPending = false
      }
    }

    const handleFullscreenChange = () => {
      const fullscreen = document.fullscreenElement === targetRef.current
      setIsFullscreen(fullscreen)
      if (fullscreen) {
        void requestWakeLock()
      } else {
        releaseWakeLock()
        disableNoSleep()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock()
      } else {
        releaseWakeLock()
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    handleFullscreenChange()

    return () => {
      disposed = true
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      releaseWakeLock()
      disableNoSleep()
    }
  }, [targetRef])

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      const target = targetRef.current
      if (!target) return

      if (!window.isSecureContext || !("wakeLock" in navigator)) {
        const noSleep = noSleepRef.current ?? new NoSleep()
        noSleepRef.current = noSleep
        void noSleep
          .enable()
          .then(() => {
            if (document.fullscreenElement !== target) noSleep.disable()
          })
          .catch((error) => console.warn("无法启用移动端防锁屏回退", error))
      }

      void target.requestFullscreen().catch((error) => {
        if (noSleepRef.current?.isEnabled) noSleepRef.current.disable()
        console.warn("无法进入全屏", error)
      })
    }
  }
  return { isFullscreen, toggle }
}

export default function Dashboard() {
  const { dark, toggle } = useTheme()
  const mainRef = useRef<HTMLElement>(null)
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(mainRef)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [globalRefreshSec, setGlobalRefreshSec] = useState(300)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const inFlight = useRef(new Set<string>())

  const loadState = async () => {
    try {
      const s = await apiClient.getState()
      setAccounts(s.accounts)
      setGlobalRefreshSec(s.settings.globalRefreshSec)
    } catch (e) {
      console.error("加载状态失败", e)
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => {
    void loadState()
  }, [])

  // React 水合后重新应用配色主题 —— inline 脚本设置的 data-theme 可能被水合覆盖
  useEffect(() => {
    applyColorTheme(readColorTheme())
  }, [])

  /** 刷新单个账号：让后端发厂商请求，成功后合并返回的账号 */
  const refreshOne = async (id: string) => {
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
    setRefreshingId(id)
    try {
      const acc = await apiClient.refreshAccount(id)
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? acc : a)))
    } catch (e) {
      const nowTs = Date.now()
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: "error",
                note: `拉取失败：${e instanceof Error ? e.message : "未知错误"}`,
                lastFetched: nowTs,
                updatedAt: formatTime(nowTs),
              }
            : a
        )
      )
    } finally {
      inFlight.current.delete(id)
      setRefreshingId((cur) => (cur === id ? null : cur))
    }
  }

  // 1s ticker：到期的账号交给后端刷新（单卡间隔优先于全局）
  const globalRef = useRef(globalRefreshSec)
  globalRef.current = globalRefreshSec
  useEffect(() => {
    const timer = setInterval(() => {
      const nowTs = Date.now()
      setNow(nowTs)
      setAccounts((prev) => {
        for (const a of prev) {
          const eff = a.refreshSec ?? globalRef.current
          if (eff > 0 && nowTs - a.lastFetched >= eff * 1000) {
            void refreshOne(a.id)
          }
        }
        return prev
      })
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshAll = async () => {
    setNow(Date.now())
    try {
      setAccounts(await apiClient.refreshAll())
    } catch (e) {
      console.error("刷新全部失败", e)
    }
  }

  const handleSave = async (input: AccountInput) => {
    if (editing) {
      await apiClient.updateAccount(editing.id, input)
    } else {
      await apiClient.createAccount(input)
    }
    setDialogOpen(false)
    await loadState()
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    await apiClient.deleteAccount(confirmDelete.id)
    setConfirmDelete(null)
    await loadState()
  }

  const handleGlobalRefresh = async (v: number) => {
    setGlobalRefreshSec(v)
    try {
      await apiClient.setSettings(v)
    } catch (e) {
      console.error("保存全局刷新间隔失败", e)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setAccounts((prev) => {
      const from = prev.findIndex((a) => a.id === active.id)
      const to = prev.findIndex((a) => a.id === over.id)
      if (from < 0 || to < 0) return prev
      const next = arrayMove(prev, from, to)
      void apiClient
        .reorder(next.map((a) => a.id))
        .then(setAccounts)
        .catch((e) => console.error("保存排序失败", e))
      return next
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  })
  const alerts = accounts.filter((p) => p.status !== "ok").length

  return (
    <div className="min-h-screen">
      {/* 报头 Masthead */}
      <header className="border-b-2 border-foreground">
        <div className="mx-auto flex max-w-[1600px] items-stretch justify-between px-5 sm:px-8">
          <div className="flex items-center gap-4 py-5">
            <span className="block h-4 w-4 bg-accent" aria-hidden />
            <div>
              <h1 className="text-2xl font-black leading-none tracking-tighter sm:text-3xl">
                能量条
              </h1>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                AI 订阅用量 · 余额总览 · ENERGY BAR
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 border-l border-border pl-4">
            <Button
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              新增接入
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label="新增接入"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="立即刷新全部" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换明暗模式">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              aria-label="外观设置"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* 元信息条：日期 / 数量 / 告警 / 全局刷新 */}
      <div className="border-b border-border">
        <div className="mx-auto grid max-w-[1600px] grid-cols-2 divide-x divide-border text-[10px] font-semibold uppercase tracking-[0.18em] sm:grid-cols-4">
          <div className="px-5 py-2.5 sm:px-8">{dateStr}</div>
          <div className="px-5 py-2.5">
            账号 <span className="tabular-nums">{accounts.length}</span>
          </div>
          <div className="px-5 py-2.5">
            告警 <span className={alerts > 0 ? "text-accent" : ""}>{alerts}</span>
          </div>
          <label className="flex items-center gap-2 px-5 py-1.5 sm:px-8">
            <span className="shrink-0 text-muted-foreground">全局刷新</span>
            <select
              className="w-full appearance-none bg-transparent py-1 uppercase outline-none"
              value={String(globalRefreshSec)}
              onChange={(e) => handleGlobalRefresh(Number(e.target.value))}
            >
              {REFRESH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 卡片网格：严格对齐、行内等高，响应式列数；支持拖拽排序 */}
      <main
        ref={mainRef}
        className={cn(
          "mx-auto max-w-[1600px] px-3 pb-12 pt-4 sm:px-8 sm:pb-16 sm:pt-6",
          isFullscreen &&
            "h-screen w-screen max-w-none overflow-y-auto bg-background pt-2 sm:pt-8"
        )}
      >
        {isFullscreen && (
          <div className="fixed bottom-3 right-3 z-50 sm:bottom-auto sm:top-3">
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} aria-label="退出全屏">
              <Minimize className="h-4 w-4" />
            </Button>
          </div>
        )}
        {!loaded && (
          <div className="py-16 text-center text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            加载中…
          </div>
        )}
        {loaded && accounts.length === 0 && (
          <div className="border border-dashed border-border py-20 text-center">
            <span className="block h-3 w-3 bg-accent" aria-hidden />
            <p className="mt-4 text-sm font-bold uppercase tracking-[0.24em]">
              暂无接入
            </p>
            <p className="mt-2 text-xs tracking-[0.1em] text-muted-foreground">
              点击右上角「+ 新增接入」，选择供应商并填写凭据
            </p>
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={accounts.map((a) => a.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 items-stretch gap-2 xs:grid-cols-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
              {accounts.map((a) => {
                const vendor = VENDOR_MAP[a.vendorId]
                if (!vendor) return null
                return (
                  <ProviderCard
                    key={a.id}
                    account={a}
                    vendor={vendor}
                    globalRefreshSec={globalRefreshSec}
                    now={now}
                    onRefresh={(acc) => void refreshOne(acc.id)}
                    refreshing={refreshingId === a.id}
                    onEdit={(acc) => {
                      setEditing(acc)
                      setDialogOpen(true)
                    }}
                    onDelete={setConfirmDelete}
                  />
                )
              })}
            </div>
          </SortableContext>
        </DndContext>

        {/* 页脚 */}
        <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>凭据仅存后端 · 不出服务器</span>
          <span>
            <span className="text-accent">*</span> 单卡刷新间隔 · 优先于全局
          </span>
        </footer>
      </main>

      <AccountDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />

      <ThemeSettings open={settingsOpen} dark={dark} onClose={() => setSettingsOpen(false)} />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除接入"
        description={
          confirmDelete
            ? `确定删除「${VENDOR_MAP[confirmDelete.vendorId]?.name ?? ""} · ${confirmDelete.label}」？该账号的用量与配置将一并移除，此操作不可恢复。`
            : ""
        }
        confirmLabel="删除"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
