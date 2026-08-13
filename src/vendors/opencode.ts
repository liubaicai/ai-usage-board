import { httpGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * OpenCode（opencode.ai Go 订阅）· 订阅制
 * 接入方式：opencode 控制台 Settings → API Keys 生成的 API Key（sk- 开头）
 *
 * 官方接口（2026-07 起，替代原 _server server-function 逆向接口）：
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Headers: Authorization: Bearer <API Key>
 * 响应：{ usage: { rolling: {percent, resetsAt}, weekly: {...}, monthly: {...} } }
 * percent 为整数百分比，resetsAt 为 ISO8601 时间。
 */
export const opencode: VendorDef = {
  id: "opencode",
  name: "OpenCode",
  vendor: "OpenCode",
  kind: "subscription",
  authType: "apikey",
  windowTemplates: [
    { id: "oc-5h", label: "5 小时限额" },
    { id: "oc-weekly", label: "每周限额" },
    { id: "oc-monthly", label: "每月限额" },
  ],
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "sk-...（opencode 控制台 Settings → API Keys 生成）",
      secret: true,
      required: true,
    },
  ],
}

const USAGE_API = "https://opencode.ai/zen/go/v1/usage"

interface UsageItem {
  percent?: number
  resetsAt?: string
}

const fmtReset = (resetsAt?: string): string | undefined => {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - Date.now()
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

export const adapter: Adapter = async (config) => {
  const apiKey = config.apiKey?.trim()
  if (!apiKey) {
    throw new Error(
      "缺少 API Key：请在编辑中填入 opencode 控制台 Settings → API Keys 生成的密钥（旧版 Cookie 方式已失效）"
    )
  }

  let data: unknown
  try {
    data = await httpGetJson(USAGE_API, { Authorization: `Bearer ${apiKey}` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    if (/401|403/.test(msg)) throw new Error("API Key 无效或已过期，请重新生成")
    throw e
  }

  const usage = (data as { usage?: Record<string, UsageItem> })?.usage
  if (!usage || typeof usage !== "object") {
    throw new Error(`响应缺少 usage 字段：${JSON.stringify(data).slice(0, 200)}`)
  }

  // 官方 API 三个窗口：rolling(5h) / weekly / monthly
  const slots: { key: string; id: string; label: string }[] = [
    { key: "rolling", id: "oc-5h", label: "5 小时限额" },
    { key: "weekly", id: "oc-weekly", label: "每周限额" },
    { key: "monthly", id: "oc-monthly", label: "每月限额" },
  ]
  const windows: QuotaWindow[] = []
  for (const slot of slots) {
    const item = usage[slot.key]
    if (item && typeof item.percent === "number" && !Number.isNaN(item.percent)) {
      windows.push({
        id: slot.id,
        label: slot.label,
        usedPercent: Math.min(100, Math.max(0, Math.round(item.percent))),
        resetIn: fmtReset(item.resetsAt),
      })
    }
  }
  if (!windows.length) {
    throw new Error(
      `响应缺少用量字段（API Key 可能无 Go 订阅）：${JSON.stringify(usage).slice(0, 200)}`
    )
  }
  return { windows, status: "ok", note: "OpenCode Go 订阅用量", plan: "OpenCode Go" }
}
