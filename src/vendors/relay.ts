import { httpGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { Balance, VendorDef } from "@/lib/types"

/**
 * 中转站（OpenAI 兼容计费）· 按量付费
 * 接入方式：Base URL + API Key（Bearer 鉴权），支持每接入独立代理。
 * 计费接口格式（自动检测或手动指定）：
 *  1) OpenAI 兼容计费（new-api / one-api / uni-api 等通用）：
 *     GET {base}/v1/dashboard/billing/subscription → hard_limit_usd（总额 USD）
 *     GET {base}/v1/dashboard/billing/usage?start_date&end_date → total_usage（已用 USD）
 *  2) one-api 原生：GET {base}/api/user/self → data.remain_quota（1 美元 = 500000 quota）
 *  3) sub2api 专用：GET {base}/v1/usage → 余额 + 用量统计
 */
export const relay: VendorDef = {
  id: "relay",
  name: "中转站",
  vendor: "Relay",
  kind: "payg",
  authType: "apikey",
  currency: "USD",
  fields: [
    {
      key: "baseUrl",
      label: "Base URL",
      placeholder: "如 https://api.example.com（不要带 /v1 后缀）",
      required: true,
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "sk-...（中转站后台创建的密钥）",
      secret: true,
      required: true,
    },
    {
      key: "format",
      label: "计费接口格式",
      required: true,
      options: [
        { value: "auto", label: "自动检测（推荐）" },
        { value: "openai", label: "OpenAI 兼容（new-api / one-api / uni-api）" },
        { value: "oneapi", label: "one-api 原生 /api/user/self" },
        { value: "sub2api", label: "sub2api /v1/usage" },
      ],
    },
  ],
}

/** one-api 额度单位：1 美元 = 500000 quota */
const QUOTA_PER_USD = 500000

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const bearer = (key: string) => ({
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
})

/** OpenAI 兼容计费：subscription（总额）+ usage（已用） */
async function tryOpenAICompat(base: string, key: string): Promise<Balance | null> {
  const sub = (await httpGetJson(`${base}/v1/dashboard/billing/subscription`, bearer(key))) as {
    hard_limit_usd?: unknown
    soft_limit_usd?: unknown
    system_hard_limit_usd?: unknown
  }
  const total = num(sub.hard_limit_usd) ?? num(sub.soft_limit_usd) ?? num(sub.system_hard_limit_usd)
  if (total === null) return null // 响应结构不对 → 让自动检测换下一种格式
  let used = 0
  try {
    const end = new Date()
    const start = new Date(end.getTime() - 90 * 86_400_000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const u = (await httpGetJson(
      `${base}/v1/dashboard/billing/usage?start_date=${fmt(start)}&end_date=${fmt(end)}`,
      bearer(key)
    )) as { total_usage?: unknown }
    used = num(u.total_usage) ?? 0
  } catch {
    // usage 接口失败不阻塞：至少展示总额
  }
  return { amount: Math.max(0, total - used), currency: "USD", totalBalance: total }
}

/** one-api 原生：/api/user/self → remain_quota */
async function tryOneApiSelf(base: string, key: string): Promise<Balance | null> {
  const d = (await httpGetJson(`${base}/api/user/self`, bearer(key))) as {
    data?: { remain_quota?: unknown; quota?: unknown }
  }
  const remainQuota = num(d.data?.remain_quota) ?? num(d.data?.quota)
  if (remainQuota === null) return null
  return { amount: remainQuota / QUOTA_PER_USD, currency: "USD" }
}

/** sub2api：/v1/usage → 余额（宽松解析常见字段名） */
async function trySub2api(base: string, key: string): Promise<Balance | null> {
  const d = (await httpGetJson(`${base}/v1/usage`, bearer(key))) as Record<string, unknown>
  const inner = d.data && typeof d.data === "object" ? (d.data as Record<string, unknown>) : {}
  const candidates = [
    d.balance,
    d.remaining,
    d.quota,
    d.credits,
    inner.balance,
    inner.remaining,
    inner.quota,
  ]
  const bal = candidates.map(num).find((n): n is number => n !== null)
  if (bal === undefined) return null
  return { amount: bal, currency: "USD" }
}

/** 路径不存在类错误（404/405/400）→ 自动检测时换下一种格式 */
function isPathNotFound(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : ""
  return /HTTP 404|HTTP 405|HTTP 400/.test(msg)
}

export const adapter: Adapter = async (config) => {
  const base = (config.baseUrl ?? "").trim().replace(/\/+$/, "")
  const key = config.apiKey?.trim()
  if (!base) throw new Error("缺少 Base URL，请在编辑中填写")
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const format = config.format ?? "auto"

  const tries: { name: string; fn: () => Promise<Balance | null> }[] = []
  if (format === "openai" || format === "auto")
    tries.push({ name: "OpenAI 兼容计费", fn: () => tryOpenAICompat(base, key) })
  if (format === "oneapi" || format === "auto")
    tries.push({ name: "one-api user/self", fn: () => tryOneApiSelf(base, key) })
  if (format === "sub2api" || format === "auto")
    tries.push({ name: "sub2api /v1/usage", fn: () => trySub2api(base, key) })

  let lastErr: Error | null = null
  for (const t of tries) {
    try {
      const bal = await t.fn()
      if (bal) return { balance: bal, status: "ok", note: `中转站余额（${t.name}）` }
      lastErr = new Error(`${t.name}：响应结构无法识别`)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (!isPathNotFound(e)) throw e // 401 / 网络错误直接抛，不再试下一种
    }
  }
  throw lastErr ?? new Error("无法识别中转站计费接口格式")
}
