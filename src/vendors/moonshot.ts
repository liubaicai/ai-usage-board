import { authGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { Balance, QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Moonshot (Kimi) · 按量计费 + Kimi Code（Coding Plan 余量）
 * 接入方式：API Key（Bearer 鉴权）；
 * 区域可选：
 *  - cn / intl：开放平台按量余额（Key 在 platform.moonshot.cn / platform.kimi.ai，sk- 开头）
 *  - coding-cn / coding-intl：Kimi Code 平台 Coding Plan 余量
 *    （Key 在 Kimi Code 控制台创建，sk-kimi- 开头；国内 kimi.moonshot.cn/code、国际 kimi.com/code。
 *     Kimi Code 会员 API 只有一套：api.kimi.com/coding/v1，官方无国内分站）
 * 注意：Kimi Code 与开放平台的 Key 不互通（官方 FAQ 明确）。
 */
export const moonshot: VendorDef = {
  id: "moonshot",
  name: "Moonshot (Kimi)",
  vendor: "月之暗面",
  kind: "payg",
  authType: "apikey",
  currency: "CNY",
  fields: [
    {
      key: "region",
      label: "区域",
      required: true,
      options: [
        { value: "cn", label: "国内站 api.moonshot.cn · 按量余额" },
        { value: "intl", label: "国际站 api.moonshot.ai · 按量余额" },
        { value: "coding-cn", label: "国内站 Coding · Coding Plan 余量" },
        { value: "coding-intl", label: "国际站 Coding · Coding Plan 余量" },
      ],
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder:
        "按量 sk-... / Kimi Code 用 sk-kimi-...（Kimi Code 控制台创建，两平台 Key 不互通）",
      secret: true,
      required: true,
    },
  ],
}

const BASE: Record<string, string> = {
  cn: "https://api.moonshot.cn",
  intl: "https://api.moonshot.ai",
}

/* ---- Kimi Code（Coding Plan）余量：GET {base}/usages（404 回退 /usage） ---- */
// Kimi Code 会员 API 统一走 api.kimi.com/coding/v1（官方无国内分站）
const CODING_BASE = "https://api.kimi.com/coding/v1"
const KIMI_UA = "KimiCLI/1.6"

interface KimiLimitItem {
  name?: string
  title?: string
  model_name?: string
  used?: number
  used_amount?: number
  limit?: number
  limit_amount?: number
  remaining?: number
  resetTime?: string | number
  reset_at?: string
  reset_time?: string
  reset_in?: number
  duration?: number
  timeUnit?: string
  window?: { duration?: number; timeUnit?: string }
  detail?: Partial<KimiLimitItem>
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** resetTime/reset_at/reset_time（ISO 或秒级时间戳）或 reset_in（秒）→ "3h 12m" */
function kimiResetIn(d: KimiLimitItem): string | undefined {
  const raw = d.resetTime ?? d.reset_at ?? d.reset_time
  let ms: number | null = null
  if (typeof raw === "number") ms = raw * 1000
  else if (typeof raw === "string") {
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) ms = t
  }
  const fmt = (diffMs: number) => {
    if (diffMs <= 0) return "即将重置"
    const h = Math.floor(diffMs / 3_600_000)
    const m = Math.floor((diffMs % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
  }
  if (ms !== null) return fmt(ms - Date.now())
  const resetIn = num(d.reset_in)
  if (resetIn !== null) return fmt(resetIn * 1000)
  return undefined
}

/** window.duration/timeUnit → 中文窗口名（统一：5 小时窗口固定叫「5 小时限额」） */
function kimiWindowLabel(d: KimiLimitItem, idx: number): string {
  const w = d.window ?? {}
  const duration = num(w.duration ?? d.duration)
  const unit = String(w.timeUnit ?? d.timeUnit ?? "").toUpperCase()
  if (duration !== null) {
    if (unit.includes("WEEK") || (unit.includes("DAY") && duration >= 7))
      return "每周限额"
    if (unit.includes("HOUR")) return duration === 5 ? "5 小时限额" : `${duration} 小时限额`
    if (unit.includes("MINUTE")) {
      // 300 分钟等能整除 60 的分钟数统一换算为小时
      const hours = duration / 60
      if (Number.isInteger(hours))
        return hours === 5 ? "5 小时限额" : `${hours} 小时限额`
      return `${duration} 分钟限额`
    }
    if (unit.includes("DAY")) return `${duration} 天限额`
    if (unit.includes("MONTH")) return "每月限额"
    return `${duration}${unit} 限额`
  }
  return `限额 ${idx + 1}`
}

function kimiRow(raw: KimiLimitItem, label: string, idx: number): QuotaWindow | null {
  const d: KimiLimitItem = raw.detail && typeof raw.detail === "object" ? { ...raw, ...raw.detail } : raw
  const limit = num(d.limit ?? d.limit_amount)
  let used = num(d.used ?? d.used_amount)
  const remaining = num(d.remaining)
  if (used === null && limit !== null && remaining !== null) used = limit - remaining
  if (used === null && limit === null) return null
  return {
    id: `kimi-${idx}`,
    label,
    usedPercent:
      limit !== null && limit > 0 ? Math.min(100, Math.round(((used ?? 0) / limit) * 100)) : 0,
    resetIn: kimiResetIn(d),
    detail: used !== null && limit !== null ? `${used}/${limit}` : undefined,
  }
}

/** 解析 /usages 的两种响应形态（data 数组 或 usage+limits 对象） */
function parseKimi(payload: Record<string, unknown>): QuotaWindow[] {
  const out: QuotaWindow[] = []
  const list = payload.data
  if (Array.isArray(list)) {
    list.forEach((item, i) => {
      if (!item || typeof item !== "object") return
      const row = item as KimiLimitItem
      const isSummary = row.model_name === "all"
      const w = kimiRow(row, isSummary ? "每周限额" : row.name || row.title || row.model_name || `限额 ${out.length + 1}`, out.length)
      if (w) out.push(w)
    })
  } else {
    if (payload.usage && typeof payload.usage === "object") {
      const w = kimiRow(payload.usage as KimiLimitItem, "每周限额", out.length)
      if (w) out.push(w)
    }
    if (Array.isArray(payload.limits)) {
      ;(payload.limits as unknown[]).forEach((item, i) => {
        if (!item || typeof item !== "object") return
        const w = kimiRow(item as KimiLimitItem, kimiWindowLabel(item as KimiLimitItem, i), out.length)
        if (w) out.push(w)
      })
    }
  }
  // 5 小时窗口在前、每周窗口在后
  const rank = (w: QuotaWindow) =>
    w.label.includes("5 小时") ? 0 : w.label.includes("每周") ? 1 : 2
  return out.sort((a, b) => rank(a) - rank(b))
}

async function fetchKimiUsage(base: string, key: string): Promise<Record<string, unknown>> {
  const headers = { "User-Agent": KIMI_UA }
  try {
    return (await authGetJson(`${base}/usages`, key, { headers })) as Record<string, unknown>
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("HTTP 404")) {
      return (await authGetJson(`${base}/usage`, key, { headers })) as Record<string, unknown>
    }
    throw e
  }
}

/**
 * 余额查询：GET {base}/v1/users/me/balance
 * 响应示例：
 * { "code": 0, "status": true, "data": {
 *   "available_balance": 49.59, "voucher_balance": 46.59, "cash_balance": 3.0 } }
 * 可用 = 现金 + 代金券
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  const region = config.region ?? "cn"
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")

  // Kimi Code（Coding Plan）余量：国内/国际 Key 都查 api.kimi.com（唯一网关）
  if (region === "coding-cn" || region === "coding-intl") {
    const payload = await fetchKimiUsage(CODING_BASE, key)
    const windows = parseKimi(payload)
    if (!windows.length) {
      throw new Error(`响应缺少用量数据：${JSON.stringify(payload).slice(0, 120)}`)
    }
    const warn = windows.some((w) => w.usedPercent >= 85)
    return {
      windows,
      status: warn ? "warn" : "ok",
      plan: "Kimi Code",
      note: "Kimi Coding Plan 配额",
    }
  }

  // 开放平台按量余额
  const base = BASE[region] ?? BASE.cn
  const data = (await authGetJson(`${base}/v1/users/me/balance`, key)) as {
    code?: number
    status?: boolean
    data?: {
      available_balance?: number
      voucher_balance?: number
      cash_balance?: number
    }
  }
  const d = data.data
  if (!d) throw new Error(`接口异常：code=${data.code ?? "未知"}`)
  const balance: Balance = {
    amount: Number(d.cash_balance ?? 0), // 现金余额（可花费）
    currency: "CNY",
    granted:
      d.voucher_balance !== undefined ? Number(d.voucher_balance) : undefined,
    totalBalance:
      d.available_balance !== undefined ? Number(d.available_balance) : undefined,
  }
  return { balance, status: "ok", note: "Kimi 实时余额" }
}
