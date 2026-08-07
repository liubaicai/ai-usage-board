import { authGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { Balance, VendorDef } from "@/lib/types"

/**
 * OpenRouter · 按量计费（美元额度）
 * 接入方式：API Key（Bearer 鉴权）
 */
export const openrouter: VendorDef = {
  id: "openrouter",
  name: "OpenRouter",
  vendor: "OpenRouter",
  kind: "payg",
  authType: "apikey",
  currency: "USD",
  fields: [
    { key: "apiKey", label: "API Key", placeholder: "sk-or-...", secret: true, required: true },
  ],
}

/**
 * 额度查询：GET https://openrouter.ai/api/v1/key
 * 响应 data 关键字段：
 * { "limit": 100, "limit_remaining": 74.5, "usage": 25.5,
 *   "usage_daily": 25.5, "usage_weekly": 25.5, "usage_monthly": 25.5,
 *   "is_free_tier": false, "label": "sk-or-..." }
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const data = (await authGetJson("https://openrouter.ai/api/v1/key", key)) as {
    data?: {
      label?: string
      limit?: number | null
      limit_remaining?: number | null
      usage?: number
      usage_daily?: number
      usage_monthly?: number
      is_free_tier?: boolean
    }
  }
  const d = data.data
  if (!d) throw new Error("响应缺少 data")
  const remaining = d.limit_remaining ?? null
  const balance: Balance = {
    amount: remaining !== null ? Number(remaining) : Number(d.usage ?? 0),
    currency: "USD",
    totalBalance: d.limit !== null && d.limit !== undefined ? Number(d.limit) : undefined,
  }
  const note = d.is_free_tier
    ? "免费档，无付费额度"
    : `累计已用 $${Number(d.usage ?? 0).toFixed(2)} · 本月 $${Number(
        d.usage_monthly ?? 0
      ).toFixed(2)}`
  return {
    balance,
    status: remaining !== null && remaining <= 0 ? "error" : "ok",
    note,
  }
}
