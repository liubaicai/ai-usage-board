import { httpGetJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Command Code（commandcode.ai）· 订阅制
 * 额度结构：月度 credits 池 + 5 小时滚动窗口 + 每周滚动窗口（用量按 USD 计）
 * 接入方式：粘贴 commandcode.ai 网页登录后的 Cookie
 *   （必须含 __Secure-commandcode_prod_.session_token 与 __Secure-commandcode_prod_.session_data；
 *    浏览器 DevTools → Application → Cookies → https://commandcode.ai 复制）
 * 接口（与官网 dashboard 同源，社区 HermesAgentBar 实证）：
 *   GET https://api.commandcode.ai/internal/billing/credits
 *   Headers: Cookie + Origin/Referer: https://commandcode.ai/（浏览器 UA）
 * 响应：
 *   { credits: { monthlyCredits, premiumMonthlyCredits, opensourceMonthlyCredits, purchasedCredits },
 *     windowLimits: { fiveHour: {used,cap,resetAt}, weekly: {used,cap,resetAt} } }
 *   used/cap 为 USD 金额，resetAt 为毫秒时间戳；usedPercent = used/cap。
 *   月度池为可滚存/购买的余额（无固定 cap），以 Balance 形式展示（月度 credits 剩余）。
 */
export const commandcode: VendorDef = {
  id: "commandcode",
  name: "Command Code",
  vendor: "commandcode.ai",
  kind: "subscription",
  authType: "cookie",
  defaultPlan: "Go",
  windowTemplates: [
    { id: "cc-5h", label: "5 小时限额" },
    { id: "cc-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "content",
      label: "网页 Cookie",
      placeholder:
        "粘贴 commandcode.ai 登录后的 Cookie（需含 __Secure-commandcode_prod_.session_token 与 session_data）",
      multiline: true,
      secret: true,
      required: true,
    },
  ],
}

const BILLING_URL = "https://api.commandcode.ai/internal/billing/credits"

/** 浏览器请求头（与官网 dashboard 一致，避免被风控拦截） */
const BROWSER_HEADERS = {
  Accept: "*/*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  Origin: "https://commandcode.ai",
  Referer: "https://commandcode.ai/",
}

/** 剩余毫秒 → "5h 12m" / "12m" */
function formatResetMs(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

interface WindowLimit {
  used?: number
  cap?: number
  resetAt?: number
}

export const adapter: Adapter = async (config) => {
  const raw = (config.content ?? "").trim()
  if (!raw) throw new Error("缺少网页 Cookie，请在编辑中粘贴")
  // 容错：用户可能粘贴 JSON 形态（{"cookie":"..."} / {"Cookie":"..."} / {"cookies":"..."}）
  let cookieHeader = raw
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const c = obj.cookie ?? obj.Cookie ?? obj.cookies
    if (typeof c === "string" && c) cookieHeader = c
  } catch {
    // 原样当作 Cookie 头使用
  }

  const data = (await httpGetJson(BILLING_URL, {
    ...BROWSER_HEADERS,
    Cookie: cookieHeader,
  }).catch((e) => {
    throw new Error(
      `计费接口请求失败（Cookie 可能失效，请重新登录 commandcode.ai 复制）：${e instanceof Error ? e.message : String(e)}`
    )
  })) as Record<string, unknown>

  const limits = (data.windowLimits ?? {}) as Record<string, unknown>
  const fh = (limits.fiveHour ?? {}) as WindowLimit
  const wk = (limits.weekly ?? {}) as WindowLimit

  const windows: QuotaWindow[] = []
  const pushWindow = (id: string, label: string, w: WindowLimit) => {
    const used = typeof w.used === "number" ? w.used : NaN
    const cap = typeof w.cap === "number" && w.cap > 0 ? w.cap : NaN
    if (Number.isNaN(used) || Number.isNaN(cap)) return
    const resetAt = typeof w.resetAt === "number" ? w.resetAt : undefined
    windows.push({
      id,
      label,
      usedPercent: Math.min(100, Math.max(0, Math.round((used / cap) * 100))),
      resetIn: resetAt ? formatResetMs(resetAt - Date.now()) : undefined,
      detail: `$${used.toFixed(2)} / $${cap.toFixed(0)}`,
    })
  }
  pushWindow("cc-5h", "5 小时限额", fh)
  pushWindow("cc-weekly", "每周限额", wk)

  const result: FetchResult = { windows, status: "ok", note: "Command Code 订阅" }

  // 月度 credits 池（剩余余额，可滚存/购买，无固定 cap → 以 Balance 展示；
  // 接口返回 0 属正常（免费/新账号），同样显示 $0.00（UI 对低余额自动标红））
  const creditsObj = (data.credits ?? {}) as Record<string, unknown>
  const monthlyCredits =
    typeof creditsObj.monthlyCredits === "number" && Number.isFinite(creditsObj.monthlyCredits)
      ? creditsObj.monthlyCredits
      : undefined
  if (monthlyCredits !== undefined) {
    result.balance = { amount: monthlyCredits, currency: "USD" }
  }

  // 仅当窗口与余额都拿不到时才视为响应异常
  if (!windows.length && !result.balance) {
    throw new Error(`计费接口响应缺少可用数据：${JSON.stringify(data).slice(0, 150)}`)
  }

  const strField = (key: string): string | undefined => {
    const v = (data as Record<string, unknown>)[key]
    return typeof v === "string" && v ? v : undefined
  }
  const plan = strField("planName") ?? strField("plan")
  if (plan) result.plan = plan
  return result
}
