import { httpGetJson, postJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Ollama Cloud（ollama.com 云端推理订阅）· 订阅制
 * 额度结构：Session（5h 滚动）+ Weekly（7d 滚动）两个窗口，fraction 0-1；超额按量计费。
 * 接入方式：API Key（ollama- 开头，ollama.com/settings → API Keys 生成）
 * 接口（官方未文档化，社区 pi-ollama-cloud / ollama-usage-widget 实证，可能变更）：
 *   GET  https://ollama.com/api/usage  Headers: Authorization: Bearer <key>
 *     → { limits: { session: {usage, models[]}, weekly: {usage, models[]} },
 *         activity: { cost, period, models } }
 *     usage 为计划上限的 0-1 分数；models 为每模型请求计数；activity.cost 为超额消费（USD 字符串）
 *   POST https://ollama.com/api/me     → { Plan, Email }（账号与计划，容错获取）
 * 注意：接口不提供重置时间戳（官方仅说明 session 每 5h / weekly 每 7d 重置），故不显示倒计时。
 */
export const ollamaCloud: VendorDef = {
  id: "ollama-cloud",
  name: "Ollama Cloud",
  vendor: "Ollama",
  kind: "subscription",
  authType: "apikey",
  defaultPlan: "Pro",
  windowTemplates: [
    { id: "ollama-5h", label: "5 小时限额" },
    { id: "ollama-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "ollama-...（ollama.com/settings → API Keys 生成）",
      secret: true,
      required: true,
    },
  ],
}

const USAGE_URL = "https://ollama.com/api/usage"
const ME_URL = "https://ollama.com/api/me"

interface UsageModel {
  name?: string
  request_count?: number
}

interface UsageLimit {
  usage?: number
  models?: UsageModel[]
}

interface UsageData {
  limits?: {
    session?: UsageLimit
    weekly?: UsageLimit
  }
  activity?: {
    cost?: string
  }
}

/** 0-1 fraction → 0-100 已用百分比（clamp，超额时封顶 100） */
function toPercent(usage: number | undefined): number | null {
  if (typeof usage !== "number" || !Number.isFinite(usage)) return null
  return Math.min(100, Math.max(0, Math.round(usage * 100)))
}

/** 每模型请求计数 → detail 文本（如 "gpt-oss:120b ×12" 取最多者，或总请求数） */
function requestsDetail(models?: UsageModel[]): string | undefined {
  if (!Array.isArray(models) || models.length === 0) return undefined
  const total = models.reduce((s, m) => s + (typeof m.request_count === "number" ? m.request_count : 0), 0)
  if (total <= 0) return undefined
  return `${total} 次请求`
}

export const adapter: Adapter = async (config) => {
  const apiKey = (config.apiKey ?? "").trim()
  if (!apiKey) throw new Error("缺少 API Key（ollama.com/settings → API Keys 生成，ollama- 开头）")
  const auth = { Authorization: `Bearer ${apiKey}` }

  const data = (await httpGetJson(USAGE_URL, auth).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (/401|403/.test(msg)) {
      throw new Error(`API Key 无效或已过期（HTTP ${msg}），请到 ollama.com/settings 重新生成`)
    }
    throw new Error(`用量接口请求失败：${msg}`)
  })) as UsageData

  const limits = data.limits ?? {}
  const windows: QuotaWindow[] = []
  const push = (id: string, label: string, limit?: UsageLimit) => {
    if (!limit) return
    const pct = toPercent(limit.usage)
    if (pct === null) return
    windows.push({
      id,
      label,
      usedPercent: pct,
      detail: requestsDetail(limit.models),
    })
  }
  push("ollama-5h", "5 小时限额", limits.session)
  push("ollama-weekly", "每周限额", limits.weekly)
  if (!windows.length) {
    throw new Error(`用量接口未返回窗口数据：${JSON.stringify(data).slice(0, 150)}`)
  }

  const result: FetchResult = { windows, status: "ok", note: "Ollama Cloud 订阅" }

  // 账号与计划（POST /api/me，失败忽略）
  try {
    const me = (await postJson(ME_URL, {}, auth)) as Record<string, unknown>
    if (typeof me.Plan === "string" && me.Plan) result.plan = me.Plan
    if (typeof me.Email === "string" && me.Email) result.accountName = me.Email
  } catch {
    // plan/email 非关键数据，获取失败不阻断
  }

  // 超额消费（窗口打满后的按量计费部分）
  const cost = (data.activity as { cost?: unknown } | undefined)?.cost
  if (typeof cost === "string" && cost && Number(cost) > 0) {
    result.note = `Ollama Cloud 订阅 · 超额消费 $${Number(cost).toFixed(2)}`
  }

  return result
}
