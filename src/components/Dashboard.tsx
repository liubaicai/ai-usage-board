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
import { Moon, Plus, RefreshCw, Sun } from "lucide-react"

import { AccountDialog } from "@/components/AccountDialog"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { ProviderCard } from "@/components/ProviderCard"
import { Button } from "@/components/ui/button"
import { VENDOR_MAP } from "@/vendors"
import { apiClient } from "@/lib/client-api"
import {
  REFRESH_OPTIONS,
  formatTime,
  type Account,
  type AccountInput,
} from "@/lib/types"

const LS_THEME = "ai-usage-theme"

function useTheme() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"))
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem(LS_THEME, dark ? "dark" : "light")
  }, [dark])
  return { dark, toggle: () => setDark((v) => !v) }
}

export default function Dashboard() {
  const { dark, toggle } = useTheme()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [globalRefreshSec, setGlobalRefreshSec] = useState(300)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
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

  /** 刷新单个账号：让后端发厂商请求，成功后合并返回的账号 */
  const refreshOne = async (id: string) => {
    if (inFlight.current.has(id)) return
    inFlight.current.add(id)
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
      <main className="mx-auto max-w-[1600px] px-5 pb-16 pt-6 sm:px-8">
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
