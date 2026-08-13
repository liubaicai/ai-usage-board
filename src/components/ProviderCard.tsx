"use client"

import { GripVertical, Pencil, RefreshCw, Trash2 } from "lucide-react"
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

/* 瑞士风格细进度条：3px 轨道，过量/告警转信号红；window 为 null 时渲染灰色占位条 */
function QuotaBar({
  window: w,
  label,
}: {
  window: QuotaWindow | null
  label?: string
}) {
  // 占位：该窗口当前无数据（如账号暂未开启 5h 限额），显示灰色空白条
  if (!w) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
            {label ?? "限额"}
          </span>
          <span className="text-[10px] tracking-[0.08em] text-muted-foreground/40">
            —
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-3 sm:mt-1.5">
          <span className="text-xl font-bold leading-none tracking-tighter text-muted-foreground/30 sm:text-3xl">
            —
          </span>
        </div>
        <div className="mt-1 h-[3px] w-full bg-foreground/5 sm:mt-2" />
      </div>
    )
  }
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
      <div className="mt-1 flex items-baseline gap-3 sm:mt-1.5">
        <span
          className={cn(
            "text-xl font-bold leading-none tracking-tighter tabular-nums sm:text-3xl",
            danger && "text-accent"
          )}
        >
          {w.usedPercent}
          <span className="text-sm font-medium sm:text-base">%</span>
        </span>
        {w.detail && (
          <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {w.detail}
          </span>
        )}
      </div>
      <div className="mt-1 h-[3px] w-full bg-foreground/10 sm:mt-2">
        <div
          className={cn("h-full transition-all", danger ? "bg-accent" : "bg-foreground")}
          style={{ width: `${Math.min(w.usedPercent, 100)}%` }}
        />
      </div>
    </div>
  )
}

/* 紧凑版进度条：窗口数 ≥3（如 OpenCode 5h/每周/每月）时使用。
 * 百分比并入进度条同一行，去掉大数字行，整卡高度与 2 窗口卡片基本持平。 */
function CompactQuotaBar({
  window: w,
  label,
}: {
  window: QuotaWindow | null
  label?: string
}) {
  if (!w) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
            {label ?? "限额"}
          </span>
          <span className="text-[10px] tracking-[0.08em] text-muted-foreground/40">—</span>
        </div>
        <div className="mt-1 h-[3px] w-full bg-foreground/5" />
      </div>
    )
  }
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
      <div className="mt-1 flex items-center gap-2 sm:mt-1.5">
        <span
          className={cn(
            "shrink-0 text-sm font-bold leading-none tracking-tighter tabular-nums sm:text-base",
            danger && "text-accent"
          )}
        >
          {w.usedPercent}%
        </span>
        <div className="h-[3px] flex-1 bg-foreground/10">
          <div
            className={cn("h-full transition-all", danger ? "bg-accent" : "bg-foreground")}
            style={{ width: `${Math.min(w.usedPercent, 100)}%` }}
          />
        </div>
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
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-card" />
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
  /** 单卡立即刷新 */
  onRefresh: (account: Account) => void
  /** 该卡片是否正在刷新（按钮旋转） */
  refreshing?: boolean
  onEdit: (account: Account) => void
  onDelete: (account: Account) => void
}

export function ProviderCard({
  account: p,
  vendor,
  globalRefreshSec,
  now,
  onRefresh,
  refreshing,
  onEdit,
  onDelete,
}: ProviderCardProps) {
  const effectiveSec = p.refreshSec ?? globalRefreshSec
  const remainMs =
    effectiveSec > 0 ? effectiveSec * 1000 - (now - p.lastFetched) : null
  /** 是否设置了自定义名称（区别于供应商默认名） */
  const customLabel = !!p.label && p.label !== vendor.name

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: p.id })

  /** 配额窗口渲染序列：有模板按模板（缺失窗口补灰色占位），模板外的窗口（如代码审查限额）追加 */
  const windows = p.windows ?? []
  const tpl = vendor.windowTemplates
  const quotaBars =
    tpl && tpl.length > 0
      ? [
          ...tpl.map((t) => ({
            key: t.id,
            label: t.label,
            w: windows.find((x) => x.label === t.label) ?? null,
          })),
          ...windows
            .filter((w) => !tpl.some((t) => t.label === w.label))
            .map((w) => ({ key: w.id, label: w.label, w })),
        ]
      : windows.map((w) => ({ key: w.id, label: w.label, w }))
  /** 窗口 ≥3（如 OpenCode 5h/每周/每月）时走紧凑模式，避免卡片过高 */
  const compact = quotaBars.length >= 3

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group relative flex h-full flex-col border border-border border-t-2 border-t-foreground bg-card px-3 py-2.5 transition-colors hover:border-foreground/60 hover:border-t-foreground sm:px-5 sm:py-5",
        isDragging &&
          "z-50 border-foreground opacity-70 shadow-[0_0_0_1px_var(--foreground)]",
        p.status === "error" && "border-accent border-t-accent"
      )}
    >
      {/* 卡头：手机显示卡片名，桌面显示接入方式 */}
      <header className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-black leading-none sm:hidden">
          {customLabel ? p.label : vendor.name}
        </h3>
        <Badge variant="muted" className="hidden px-0 sm:inline-flex">
          {AUTH_LABEL[vendor.authType]}
        </Badge>
        <div className="flex items-center gap-2">
          {p.plan && (
            <span
              className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-foreground sm:inline"
              title="套餐等级 (plan_type)"
            >
              {p.plan}
            </span>
          )}
          <StatusMark status={p.status} />
        </div>
      </header>

      {/* 主标题：自定义名称优先，否则供应商名兜底 */}
      <h3 className="mt-3 hidden truncate text-[26px] font-black leading-none tracking-tighter sm:block">
        {customLabel ? p.label : vendor.name}
      </h3>
      {/* 副标题行：厂商 · 账号名 · 订阅到期（手机端隐藏以节省纵向空间） */}
      <p className="mt-1 hidden items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:mt-1.5 sm:flex">
        <span className="shrink-0">{vendor.vendor}</span>
        {p.accountName && (
          <span className="min-w-0 truncate normal-case tracking-[0.06em]">
            {p.accountName}
          </span>
        )}
        {p.subscriptionExpiresAt && (
          <span
            className="shrink-0 normal-case tracking-[0.06em] tabular-nums"
            title="订阅到期时间"
          >
            订阅至 {p.subscriptionExpiresAt}
          </span>
        )}
      </p>

      {/* 错误信息：拉取失败 / 余额不足时显示原因 */}
      {p.status === "error" && p.note && (
        <p className="mt-1.5 border-l-2 border-accent pl-2 text-[10px] leading-relaxed tracking-[0.06em] text-accent sm:mt-2">
          {p.note}
        </p>
      )}

      {/* 主体：配额窗口（缺失的模板窗口显示灰色占位）或余额 */}
      {quotaBars.length > 0 && (
        <div
          className={cn(
            "mt-2.5 sm:mt-5",
            compact ? "space-y-2.5 sm:space-y-4" : "space-y-2.5 sm:space-y-5"
          )}
        >
          {quotaBars.map((b) =>
            compact ? (
              <CompactQuotaBar key={b.key} window={b.w} label={b.label} />
            ) : (
              <QuotaBar key={b.key} window={b.w} label={b.label} />
            )
          )}
        </div>
      )}

      {p.balance && (
        <div className="mt-2.5 sm:mt-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            当前余额
          </div>
          <div
            className={cn(
              "mt-1 text-2xl font-bold leading-none tracking-tighter tabular-nums sm:text-4xl",
              p.balance.amount < (vendor.id === "openrouter" || vendor.id === "relay" ? 10 : 20) &&
                "text-accent"
            )}
          >
            <span className="mr-1 align-top text-sm font-medium sm:text-lg">
              {p.balance.currency === "CNY" ? "¥" : "$"}
            </span>
            {p.balance.amount.toFixed(2)}
          </div>
          {/* 明细：赠送额度 / 合计 */}
          {p.balance.granted !== undefined ||
          (p.balance.totalBalance !== undefined &&
            Math.abs(p.balance.totalBalance - p.balance.amount) > 0.005) ? (
            <dl className="mt-2 space-y-1 border-t border-border pt-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:mt-3 sm:pt-3">
              {p.balance.granted !== undefined && (
                <div className="flex justify-between">
                  <dt>赠送额度</dt>
                  <dd className="tabular-nums">
                    {p.balance.currency === "CNY" ? "¥" : "$"}
                    {p.balance.granted.toFixed(2)}
                  </dd>
                </div>
              )}
              {p.balance.totalBalance !== undefined &&
                Math.abs(p.balance.totalBalance - p.balance.amount) > 0.005 && (
                  <div className="flex justify-between">
                    <dt>合计</dt>
                    <dd className="tabular-nums text-foreground">
                      {p.balance.currency === "CNY" ? "¥" : "$"}
                      {p.balance.totalBalance.toFixed(2)}
                    </dd>
                  </div>
                )}
            </dl>
          ) : null}
        </div>
      )}

      {/* 卡脚：编辑/删除按钮 + 刷新倒计时 / 更新时间（mt-auto 对齐到卡片底部） */}
      <div aria-hidden className="h-1.5 shrink-0 sm:h-5" />
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-1.5 sm:pt-2.5">
        <div className="flex items-center gap-1">
          {/* 拖拽把手：仅此区域可拖拽排序，避免整个卡片拦截触屏滑动 */}
          <button
            type="button"
            {...listeners}
            aria-label={`拖拽排序 ${p.label}`}
            title="拖拽排序"
            className="flex h-5 w-5 touch-none cursor-grab items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:cursor-grabbing sm:h-6 sm:w-6"
          >
            <GripVertical className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
          {/* 刷新/编辑/删除：有 hover 能力的设备隐藏、悬浮显示；真实触摸设备（hover:none）常驻可操作 */}
          <div className="flex items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onRefresh(p)}
              aria-label={`刷新 ${p.label}`}
              title="立即刷新"
              className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:h-6 sm:w-6"
            >
              <RefreshCw className={cn("h-2.5 w-2.5 sm:h-3 sm:w-3", refreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => onEdit(p)}
              aria-label={`编辑 ${p.label}`}
              title="编辑"
              className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:h-6 sm:w-6"
            >
              <Pencil className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(p)}
              aria-label={`删除 ${p.label}`}
              title="删除"
              className="flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-white sm:h-6 sm:w-6"
            >
              <Trash2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            </button>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] tracking-[0.08em] tabular-nums text-muted-foreground sm:gap-2.5">
          <span
            className={cn(
              "inline-block h-1 w-1",
              remainMs !== null ? "bg-foreground" : "bg-muted-foreground/40"
            )}
            title={p.refreshSec !== null ? "单卡刷新间隔" : "跟随全局刷新"}
          />
          {remainMs !== null ? formatCountdown(remainMs) : "手动"}
          {p.refreshSec !== null && <span className="text-accent">*</span>}
          <span className="hidden h-2.5 w-px bg-border sm:inline" aria-hidden />
          <span className="hidden sm:inline" title="上次刷新时间">{p.updatedAt}</span>
        </span>
      </footer>
    </article>
  )
}
