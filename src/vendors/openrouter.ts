import { authGetJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { VendorDef } from "@/lib/types"

/**
 * OpenRouter · 按量计费（美元额度）
 * 接入方式：API Key（Bearer 鉴权，推理用）+ 可选 Management Key（读取账户余额）
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
    {
      key: "managementKey",
      label: "管理密钥（可选）",
      placeholder: "sk-or-...（Management Key，仅用于读取账户余额）",
      secret: true,
    },
  ],
}

type KeyInfoResponse = {
  data?: {
    label?: string
    limit?: number | null
    limit_reset?: string | null
    limit_remaining?: number | null
    usage?: number
    usage_daily?: number
    usage_weekly?: number
    usage_monthly?: number
    is_free_tier?: boolean
  }
}

type CreditsResponse = {
  data?: { total_credits?: unknown; total_usage?: unknown }
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * 账户级余额：GET https://openrouter.ai/api/v1/credits
 * { "data": { "total_credits": 100.5, "total_usage": 25.75 } } → 余额 = total_credits - total_usage
 *
 * 该端点在 OpenRouter 官方文档中被列入「Routes That Require a Management Key」，
 * 普通推理密钥会返回 403 Only management keys can perform this operation。
 * 取不到时返回 null 走降级分支——绝不用 usage（累计计数器）冒充余额。
 */
async function accountCredits(key: string): Promise<{ total: number; used: number } | null> {
  try {
    const res = (await authGetJson(
      "https://openrouter.ai/api/v1/credits",
      key
    )) as CreditsResponse
    const total = num(res.data?.total_credits)
    const used = num(res.data?.total_usage)
    if (total === null || used === null) return null
    return { total, used }
  } catch {
    return null
  }
}

/**
 * OpenRouter 的额度分两层，端点与权限都不同：
 *  1) GET /api/v1/key（普通推理密钥即可）
 *     { "limit": null, "limit_remaining": null, "include_byok_in_limit": false,
 *       "usage": 0.18, "usage_daily": 0.18, "usage_weekly": 0.18, "usage_monthly": 0.18,
 *       "is_free_tier": false, "label": "sk-or-..." }
 *     - limit / limit_remaining 是**本 Key 的消费上限**，未设上限时恒为 null（≠ 账户余额）
 *     - usage / usage_* 是**累计消耗计数器**，不表示剩余额度
 *  2) GET /api/v1/credits（需 Management Key）
 *     { "data": { "total_credits": 100.5, "total_usage": 25.75 } } → 账户级余额
 *
 * 历史坑：旧实现用 limit_remaining ?? usage 兜底，导致 Key 未设上限的账号把「累计已用」
 * 显示成了「当前余额」。故此处只认账户余额或 Key 上限，两者都没有时展示占位「—」。
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const managementKey = config.managementKey?.trim()

  // 两个端点相互独立，并行请求；/credits 失败不影响 /key 的结果
  const [keyInfo, credits] = await Promise.all([
    authGetJson("https://openrouter.ai/api/v1/key", key) as Promise<KeyInfoResponse>,
    // 管理密钥优先；未配置时仍用推理密钥试一次（同账号密钥具备管理权限时可直接生效）
    accountCredits(managementKey || key),
  ])
  const d = keyInfo.data
  if (!d) throw new Error("响应缺少 data")

  const usage = num(d.usage) ?? 0
  const monthly = num(d.usage_monthly) ?? 0
  const keyRemaining = num(d.limit_remaining)
  const keyLimit = num(d.limit)
  const accountRemaining = credits ? credits.total - credits.used : null

  const noteParts: string[] = []
  if (d.is_free_tier) noteParts.push("免费档，无付费额度")
  noteParts.push(`累计已用 $${usage.toFixed(2)}`, `本月 $${monthly.toFixed(2)}`)

  const result: FetchResult = { status: "ok" }
  if (accountRemaining !== null) {
    // 账户级余额（权威口径）：账号下所有 Key 共用同一额度池
    result.balance = {
      amount: accountRemaining,
      currency: "USD",
      totalBalance: credits!.total,
    }
    if (keyRemaining !== null) {
      noteParts.push(`本 Key 限额剩余 $${keyRemaining.toFixed(2)}`)
    }
  } else if (keyRemaining !== null) {
    // 账户余额不可读，但本 Key 设了消费上限 → 该上限是唯一可用的额度数据
    result.balance = {
      amount: keyRemaining,
      currency: "USD",
      totalBalance: keyLimit ?? undefined,
    }
    noteParts.push("账户余额需管理密钥（此处为本 Key 限额剩余）")
  } else {
    // 账户余额不可读且本 Key 无上限：展示占位，绝不拿累计用量冒充余额
    result.windows = [
      {
        id: "openrouter-account-balance",
        label: "账户余额",
        usedPercent: 0,
        value: "—",
        detail: managementKey ? "管理密钥无效" : "需管理密钥",
      },
    ]
    noteParts.push(
      managementKey
        ? "账户余额读取失败（请检查管理密钥是否有效）"
        : "账户余额需管理密钥（openrouter.ai/docs/guides/overview/auth/management-api-keys）"
    )
  }

  const remaining = accountRemaining ?? keyRemaining
  if (remaining !== null && remaining <= 0) {
    result.status = "error"
    noteParts.unshift(`余额已耗尽（$${remaining.toFixed(2)}）`)
  }
  result.note = noteParts.join(" · ")
  return result
}
