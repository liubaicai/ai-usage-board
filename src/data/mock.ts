import type { Account, VendorDef } from "@/lib/types"
import { formatTime } from "@/lib/types"

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 新建账号时生成初始 mock 用量 */
export function createAccount(
  vendor: VendorDef,
  label: string,
  config: Record<string, string>,
  refreshSec: number | null
): Account {
  const now = Date.now()
  const base: Account = {
    id: crypto.randomUUID(),
    vendorId: vendor.id,
    label: label.trim() || vendor.name,
    plan: vendor.defaultPlan,
    config,
    refreshSec,
    status: "ok",
    lastFetched: now,
    updatedAt: formatTime(now),
  }
  if (vendor.kind === "subscription" && vendor.windowTemplates) {
    base.windows = vendor.windowTemplates.map((t) => ({
      id: t.id,
      label: t.label,
      usedPercent: Math.round(rand(5, 60)),
      resetIn: `${Math.round(rand(1, 5))}h ${String(Math.round(rand(0, 59))).padStart(2, "0")}m`,
    }))
  } else {
    const amount = +rand(20, 400).toFixed(2)
    base.balance = { amount, currency: vendor.currency ?? "CNY" }
  }
  return base
}

/** 刷新一次用量（mock：轻微抖动数值，真实接入时替换为适配器调用） */
export function refreshUsage(a: Account, vendor: VendorDef, nowTs: number): Account {
  const next: Account = { ...a, lastFetched: nowTs, updatedAt: formatTime(nowTs) }
  if (next.windows) {
    next.windows = next.windows.map((w) => ({
      ...w,
      usedPercent: Math.round(clamp(w.usedPercent + rand(-4, 6), 1, 99)),
    }))
  }
  if (next.balance) {
    next.balance = {
      ...next.balance,
      amount: Math.max(0, +(next.balance.amount - rand(0, 0.6)).toFixed(2)),
    }
  }
  next.status = deriveStatus(next, vendor)
  return next
}

function deriveStatus(a: Account, vendor: VendorDef): Account["status"] {
  if (vendor.kind === "payg" && a.balance && a.balance.amount < 20) return "error"
  if (a.windows?.some((w) => w.usedPercent >= 85)) return "warn"
  return "ok"
}
