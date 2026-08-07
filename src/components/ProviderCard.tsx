"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  AUTH_LABEL,
  formatCountdown,
  type Account,
  type QuotaWindow,
  type VendorDef,
} from "@/lib/types"

/* 瑞士风格细进度条：3px 轨道，过量/告警转信号红 */
function QuotaBar({ window: w }: { window: QuotaWindow }) {
  const danger = w.usedPercent >= 80
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {w.label}
        </span>
        <span
          className={cn(
            "text-[10px] tracking-[0.08em] tabular-nums",
            danger ? "text-accent" : "text-muted-foreground"
          )}
        >
          {w.resetIn ? `重置 ${w.resetIn}` : ""}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-3">
        <span
          className={cn(
            "text-3xl font-bold leading-none tracking-tighter tabular-nums",
            danger && "text-accent"
          )}
        >
          {w.usedPercent}
          <span className="text-base font-medium">%</span>
        </span>
        {w.detail && (
          <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {w.detail}
          </span>
        )}
      </div>
      <div className="mt-2 h-[3px] w-full bg-foreground/10">
        <div
          className={cn("h-full transition-all", danger ? "bg-accent" : "bg-foreground")}
          style={{ width: `${Math.min(w.usedPercent, 100)}%` }}
        />
      </div>
    </div>
  )
}

function StatusMark({ status }: { status: Account["status"] }) {
  if (status === "ok") return <span className="inline-block h-2 w-2 bg-foreground" />
  if (status === "warn") return <span className="inline-block h-2 w-2 bg-accent" />
  return (
    <span className="relative inline-block h-2 w-2">
      <span className="absolute inset-0 bg-accent" />
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-background" />
    </span>
  )
}

interface ProviderCardProps {
  account: Account
  vendor: VendorDef
  /** 全局刷新间隔（秒），单卡 refreshSec 为 null 时生效 */
  globalRefreshSec: number
  /** 当前时间戳，用于倒计时 */
  now: number
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}

export function ProviderCard({
  account: p,
  vendor,
  globalRefreshSec,
  now,
  onEdit,
  onDelete,
}: ProviderCardProps) {
  const effectiveSec = p.refreshSec ?? globalRefreshSec
  const remainMs =
    effectiveSec > 0 ? effectiveSec * 1000 - (now - p.lastFetched) : null

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: p.id })

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "none",
      }}
      className={cn(
        "group relative flex h-full cursor-grab flex-col border border-border border-t-2 border-t-foreground bg-background px-5 py-5 transition-colors hover:border-foreground/60 hover:border-t-foreground active:cursor-grabbing",
        isDragging &&
          "z-50 border-foreground opacity-70 shadow-[0_0_0_1px_var(--foreground)]",
        p.status === "error" && "border-accent border-t-accent"
      )}
    >
      {/* 卡头：接入方式 / 套餐 / 状态 */}
      <header className="flex items-center justify-between gap-2">
        <Badge variant="muted" className="px-0">
          {AUTH_LABEL[vendor.authType]}
        </Badge>
        <div className="flex items-center gap-2">
          {p.plan && (
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {p.plan}
            </span>
          )}
          <StatusMark status={p.status} />
        </div>
      </header>

      {/* 名称 + 账号昵称（同厂商多账号的区分）：主标题加大，一眼定位 */}
      <h3 className="mt-3 text-[26px] font-black leading-none tracking-tighter">
        {vendor.name}
      </h3>
      <p className="mt-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {vendor.vendor} · {vendor.kind === "subscription" ? "订阅制" : "按量付费"}
        {p.label && p.label !== vendor.name && (
          <span className="border border-accent px-1 py-px text-[9px] font-bold tracking-[0.12em] text-accent">
            {p.label}
          </span>
        )}
      </p>

      {/* 错误信息：拉取失败 / 余额不足时显示原因 */}
      {p.status === "error" && p.note && (
        <p className="mt-2 border-l-2 border-accent pl-2 text-[10px] leading-relaxed tracking-[0.06em] text-accent">
          {p.note}
        </p>
      )}

      {/* 主体：订阅 → 限额窗口；按量 → 余额 */}
      {vendor.kind === "subscription" && p.windows && (
        <div className="mt-5 space-y-5">
          {p.windows.map((w) => (
            <QuotaBar key={w.id} window={w} />
          ))}
        </div>
      )}

      {vendor.kind === "payg" && p.balance && (
        <div className="mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            当前余额
          </div>
          <div
            className={cn(
              "mt-1 text-4xl font-bold leading-none tracking-tighter tabular-nums",
              p.balance.amount < 20 && "text-accent"
            )}
          >
            <span className="mr-1 align-top text-lg font-medium">
              {p.balance.currency === "CNY" ? "¥" : "$"}
            </span>
            {p.balance.amount.toFixed(2)}
          </div>
          {(p.balance.granted !== undefined || p.balance.totalBalance !== undefined) && (
            <dl className="mt-3 space-y-1 border-t border-border pt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {p.balance.granted !== undefined && (
                <div className="flex justify-between">
                  <dt>赠送额度</dt>
                  <dd className="tabular-nums">
                    {p.balance.currency === "CNY" ? "¥" : "$"}
                    {p.balance.granted.toFixed(2)}
                  </dd>
                </div>
              )}
              {p.balance.totalBalance !== undefined && (
                <div className="flex justify-between">
                  <dt>合计</dt>
                  <dd className="tabular-nums text-foreground">
                    {p.balance.currency === "CNY" ? "¥" : "$"}
                    {p.balance.totalBalance.toFixed(2)}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {/* 卡脚：编辑/删除按钮 + 刷新倒计时 / 更新时间（mt-auto 对齐到卡片底部） */}
      <div aria-hidden className="h-5 shrink-0" />
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(p)}
            aria-label={`编辑 ${p.label}`}
            title="编辑"
            className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => onDelete(p)}
            aria-label={`删除 ${p.label}`}
            title="删除"
            className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-white"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <span className="flex shrink-0 items-center gap-2.5 text-[10px] tracking-[0.08em] tabular-nums text-muted-foreground">
          <span
            className={cn(
              "inline-block h-1 w-1",
              remainMs !== null ? "bg-foreground" : "bg-muted-foreground/40"
            )}
            title={p.refreshSec !== null ? "单卡刷新间隔" : "跟随全局刷新"}
          />
          {remainMs !== null ? formatCountdown(remainMs) : "手动"}
          {p.refreshSec !== null && <span className="text-accent">*</span>}
          <span className="h-2.5 w-px bg-border" aria-hidden />
          <span title="上次刷新时间">{p.updatedAt}</span>
        </span>
      </footer>
    </article>
  )
}
