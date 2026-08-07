import { useEffect, useRef, useState } from "react"
import { Moon, Plus, RefreshCw, Sun } from "lucide-react"

import { AccountDialog } from "@/components/AccountDialog"
import { ProviderCard } from "@/components/ProviderCard"
import { Button } from "@/components/ui/button"
import { seedAccounts } from "@/data/accounts"
import { refreshUsage } from "@/data/mock"
import { VENDOR_MAP } from "@/data/vendors"
import { REFRESH_OPTIONS, type Account } from "@/lib/types"

const LS_ACCOUNTS = "ai-usage-accounts"
const LS_GLOBAL_REFRESH = "ai-usage-global-refresh"
const LS_THEME = "ai-usage-theme"

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(LS_ACCOUNTS)
    if (raw) {
      const list = JSON.parse(raw) as Account[]
      if (Array.isArray(list) && list.length > 0) return list
    }
  } catch {
    /* 数据损坏则回落到种子数据 */
  }
  return seedAccounts()
}

function loadGlobalRefresh(): number {
  const raw = Number(localStorage.getItem(LS_GLOBAL_REFRESH))
  return Number.isFinite(raw) && raw >= 0 && raw <= 86400 ? raw : 300
}

function useTheme() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem(LS_THEME, dark ? "dark" : "light")
  }, [dark])
  return { dark, toggle: () => setDark((v) => !v) }
}

export default function App() {
  const { dark, toggle } = useTheme()
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts)
  const [globalRefreshSec, setGlobalRefreshSec] = useState(loadGlobalRefresh)
  const [now, setNow] = useState(Date.now())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)

  // 持久化
  useEffect(() => {
    localStorage.setItem(LS_ACCOUNTS, JSON.stringify(accounts))
  }, [accounts])
  useEffect(() => {
    localStorage.setItem(LS_GLOBAL_REFRESH, String(globalRefreshSec))
  }, [globalRefreshSec])

  // 1s ticker：刷新到期的账号（单卡间隔优先于全局）
  const globalRef = useRef(globalRefreshSec)
  globalRef.current = globalRefreshSec
  useEffect(() => {
    const timer = setInterval(() => {
      const nowTs = Date.now()
      setNow(nowTs)
      setAccounts((prev) => {
        let changed = false
        const next = prev.map((a) => {
          const eff = a.refreshSec ?? globalRef.current
          if (eff > 0 && nowTs - a.lastFetched >= eff * 1000) {
            changed = true
            return refreshUsage(a, VENDOR_MAP[a.vendorId], nowTs)
          }
          return a
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const refreshAll = () => {
    const nowTs = Date.now()
    setNow(nowTs)
    setAccounts((prev) =>
      prev.map((a) => refreshUsage(a, VENDOR_MAP[a.vendorId], nowTs))
    )
  }

  const upsertAccount = (acc: Account) =>
    setAccounts((prev) =>
      prev.some((a) => a.id === acc.id)
        ? prev.map((a) => (a.id === acc.id ? acc : a))
        : [...prev, acc]
    )

  const deleteAccount = (id: string) =>
    setAccounts((prev) => prev.filter((a) => a.id !== id))

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
              onChange={(e) => setGlobalRefreshSec(Number(e.target.value))}
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

      {/* 卡片网格：严格对齐、行内等高，响应式列数 */}
      <main className="mx-auto max-w-[1600px] px-5 pb-16 pt-6 sm:px-8">
        <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                onEdit={(acc) => {
                  setEditing(acc)
                  setDialogOpen(true)
                }}
              />
            )
          })}
        </div>

        {/* 页脚 */}
        <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>凭据仅存本地 · 不上传</span>
          <span>
            <span className="text-accent">*</span> 单卡刷新间隔 · 优先于全局
          </span>
        </footer>
      </main>

      <AccountDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSave={upsertAccount}
        onDelete={deleteAccount}
      />
    </div>
  )
}
