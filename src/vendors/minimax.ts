import { authGetJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * MiniMax（海螺 AI）· 订阅制（Coding Plan / Token Plan）
 * 接入方式：API Key（Token Plan 专属 Subscription Key，与按量 API Key 不通用）
 * 接口：GET {base}/v1/api/openplatform/coding_plan/remains（Bearer Key）
 * 响应：{ base_resp, model_remains: [{ current_interval_total_count,
 *        current_interval_usage_count, end_time, remains_time, ... }], plan_name }
 * 窗口：5 小时滚动窗口
 */
export const minimax: VendorDef = {
  id: "minimax",
  name: "MiniMax",
  vendor: "MiniMax",
  kind: "subscription",
  authType: "apikey",
  windowTemplates: [{ id: "mm-5h", label: "5 小时限额" }],
  fields: [
    {
      key: "region",
      label: "区域",
      required: true,
      options: [
        { value: "global", label: "国际站 api.minimax.io" },
        { value: "cn", label: "国内站 api.minimaxi.com" },
      ],
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "Token Plan / Coding Plan 的 Subscription Key",
      secret: true,
      required: true,
    },
  ],
}

const BASE: Record<string, string> = {
  global: "https://api.minimax.io",
  cn: "https://api.minimaxi.com",
}

export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  const base = BASE[config.region ?? "global"]
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const data = (await authGetJson(
    `${base}/v1/api/openplatform/coding_plan/remains`,
    key
  )) as {
    base_resp?: { status_code?: number; status_msg?: string }
    model_remains?: {
      current_interval_total_count?: number
      current_interval_usage_count?: number
      current_interval_remaining_count?: number
      current_interval_remains_count?: number
      end_time?: number
      remains_time?: number
    }[]
    plan_name?: string
    current_subscribe_title?: string
  }

  if (data.base_resp && data.base_resp.status_code !== undefined && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax API 错误：${data.base_resp.status_msg ?? data.base_resp.status_code}`)
  }
  const m = data.model_remains?.[0]
  if (!m || m.current_interval_total_count === undefined) {
    throw new Error(`响应缺少用量数据：${JSON.stringify(data).slice(0, 150)}`)
  }

  const total = Number(m.current_interval_total_count) || 0
  // 优先 remaining 字段反推 used，否则用 usage_count
  const hasRemaining =
    m.current_interval_remaining_count !== undefined ||
    m.current_interval_remains_count !== undefined
  const remaining = Number(
    m.current_interval_remaining_count ?? m.current_interval_remains_count ?? 0
  )
  const used = hasRemaining ? total - remaining : Number(m.current_interval_usage_count ?? 0)
  const usedPercent = total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0

  const resetTs = m.end_time ?? m.remains_time
  const windows: QuotaWindow[] = [
    {
      id: "mm-5h",
      label: "5 小时限额",
      usedPercent,
      resetIn:
        typeof resetTs === "number" && resetTs > 0
          ? (() => {
              // end_time 可能是秒或毫秒
              const ms = (resetTs > 1e12 ? resetTs : resetTs * 1000) - Date.now()
              if (ms <= 0) return "即将重置"
              const h = Math.floor(ms / 3_600_000)
              const m = Math.floor((ms % 3_600_000) / 60_000)
              return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
            })()
          : undefined,
      detail: `${used}/${total}`,
    },
  ]
  const result: FetchResult = { windows, status: "ok", note: "MiniMax Coding Plan 配额" }
  const plan = data.current_subscribe_title ?? data.plan_name
  if (plan) result.plan = String(plan)
  return result
}
