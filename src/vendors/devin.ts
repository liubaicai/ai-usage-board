import { httpGetJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Devin（Devin Desktop）· 订阅制（每日/每周配额）
 * 接入方式：Bearer Token（从 app.devin.ai 请求里抓取）+ 组织 ID
 * 接口（社区逆向，experimental）：GET https://app.devin.ai/api/<org-id>/billing/quota/usage
 *   Headers: Authorization: Bearer <token>
 * 响应：每日/每周配额百分比 + 重置时间戳（字段名以实测为准，做了宽松解析）
 */
export const devin: VendorDef = {
  id: "devin",
  name: "Devin",
  vendor: "Devin",
  kind: "subscription",
  authType: "apikey",
  fields: [
    {
      key: "token",
      label: "Bearer Token",
      placeholder: "app.devin.ai 请求中的 Authorization Bearer 值",
      secret: true,
      required: true,
    },
    {
      key: "orgId",
      label: "组织 ID",
      placeholder: "app.devin.ai/api/<这里>/billing/quota/usage 中的 ID",
      required: true,
    },
  ],
}

interface QuotaPart {
  percentage?: number
  used?: number
  limit?: number
  remaining?: number
  resetAt?: string
  resetInSec?: number
}

function fmtReset(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined
  let ms: number
  if (typeof v === "number") {
    ms = v > 1e12 ? v : v * 1000
  } else {
    ms = Date.parse(v)
    if (Number.isNaN(ms)) return undefined
  }
  const remain = ms - Date.now()
  if (remain <= 0) return "即将重置"
  const h = Math.floor(remain / 3_600_000)
  const m = Math.floor((remain % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

/** 宽松解析：把响应里的 daily/weekly（或数组项）提取为配额窗口 */
function parseQuota(data: Record<string, unknown>): QuotaWindow[] {
  const windows: QuotaWindow[] = []
  const norm = (o: Record<string, unknown>): QuotaPart | null => {
    const pct =
      typeof o.percentage === "number"
        ? o.percentage
        : typeof o.percent === "number"
          ? (o.percent as number)
          : undefined
    if (pct === undefined) return null
    return {
      percentage: pct,
      used: o.used as number | undefined,
      limit: o.limit as number | undefined,
      remaining: o.remaining as number | undefined,
      resetAt:
        (o.resetAt as string | undefined) ??
        (o.reset_at as string | undefined) ??
        (o.nextReset as string | undefined),
      resetInSec: o.resetInSec as number | undefined,
    }
  }
  const push = (id: string, label: string, p: QuotaPart | null) => {
    if (!p || p.percentage === undefined) return
    windows.push({
      id,
      label,
      usedPercent: Math.min(100, Math.max(0, Math.round(p.percentage))),
      resetIn:
        p.resetInSec !== undefined
          ? fmtReset(Date.now() + p.resetInSec * 1000)
          : fmtReset(p.resetAt),
      detail:
        p.used !== undefined && p.limit !== undefined ? `${p.used}/${p.limit}` : undefined,
    })
  }
  const daily = data.daily as Record<string, unknown> | undefined
  const weekly = data.weekly as Record<string, unknown> | undefined
  if (daily || weekly) {
    push("devin-daily", "每日配额", daily ? norm(daily) : null)
    push("devin-weekly", "每周配额", weekly ? norm(weekly) : null)
    return windows
  }
  // 数组形态：[{period:"daily",...},{period:"weekly",...}]
  if (Array.isArray(data.quotas) || Array.isArray(data.items)) {
    const arr = (Array.isArray(data.quotas) ? data.quotas : data.items) as Record<
      string,
      unknown
    >[]
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i] as Record<string, unknown>
      const period = String(it.period ?? it.type ?? it.name ?? `配额 ${i + 1}`)
      push(
        `devin-${i}`,
        period.includes("week") || period.includes("周")
          ? "每周配额"
          : period.includes("day") || period.includes("日")
            ? "每日配额"
            : period,
        norm(it)
      )
    }
    return windows
  }
  return windows
}

export const adapter: Adapter = async (config) => {
  const token = (config.token ?? "").trim()
  const orgId = (config.orgId ?? "").trim()
  if (!token) throw new Error("缺少 Bearer Token，请在编辑中填写")
  if (!orgId) throw new Error("缺少组织 ID，请在编辑中填写")
  const data = (await httpGetJson(
    `https://app.devin.ai/api/${encodeURIComponent(orgId)}/billing/quota/usage`,
    { Authorization: `Bearer ${token}`, Accept: "application/json" }
  )) as Record<string, unknown>
  const windows = parseQuota(data)
  if (!windows.length) {
    throw new Error(
      `响应结构未识别（experimental 接口）：${JSON.stringify(data).slice(0, 200)}`
    )
  }
  return { windows, status: "ok", note: "Devin 每日/每周配额（experimental）" }
}
