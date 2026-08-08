import { httpGetJson, postForm } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { Balance, QuotaWindow } from "@/lib/types"

/**
 * Codex（OpenAI ChatGPT 订阅）用量查询公共模块。
 * 用量接口（openusage-community 逆向文档）：
 *   GET https://chatgpt.com/backend-api/wham/usage
 *   Headers: Authorization: Bearer <access_token>
 *            ChatGPT-Account-Id: <account_id>（可选）
 *   Response: { plan_type, rate_limit: { primary_window(5h), secondary_window(7d) },
 *               code_review_rate_limit?, credits?{balance} }
 * 支持的授权来源（统一解析为 access_token）：
 *   - auth.json：{ tokens: { access_token, refresh_token, account_id }, last_refresh }
 *   - cliproxy / CPA 导出：{ type:"codex", account_id, access_token, session_token, ... }
 *   - sub2api 导出：{ accounts: [{ credentials: { access_token, chatgpt_account_id } }] }
 *   - chatgpt.com 网页 Cookie：走 GET https://chatgpt.com/api/auth/session 交换 access_token
 */

export interface CodexCredential {
  accessToken?: string
  accountId?: string
  refreshToken?: string
  cookieHeader?: string
  /** 账号名（邮箱 / 用户名，从授权内容直接提取，如 sub2api 的 name / email） */
  accountName?: string
  /** access_token 过期时间（ISO 字符串，优先于 JWT exp 用于主动刷新判断） */
  tokenExpiresAt?: string
  /** 订阅到期时间（ISO 字符串） */
  subscriptionExpiresAt?: string
  /** 导出信息里的套餐类型 */
  planType?: string
}

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

/** access_token 剩余有效期低于该阈值（ms）时，主动用 refresh_token 刷新 */
const REFRESH_AHEAD_MS = 10 * 60 * 1000

/* ---- JWT 工具：解码 payload / 取 exp（用于主动刷新判断） ---- */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    const json = decodeURIComponent(
      Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** access_token 的过期时间戳（ms）。JWT exp 可能为秒或毫秒，统一转 ms */
function jwtExpiresAt(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== "number") return null
  return payload.exp > 1e12 ? payload.exp : payload.exp * 1000
}

/** 时间戳/ISO 字符串 → "YYYY-MM-DD"（订阅到期显示用） */
function formatDate(v: string | number): string {
  let ms: number
  if (typeof v === "number") {
    ms = v > 1e12 ? v : v * 1000
  } else {
    const t = Date.parse(v)
    if (Number.isNaN(t)) return String(v)
    ms = t
  }
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 刷新后的新凭证 → auth.json 格式（兜底：无法识别原格式时使用） */
function buildAuthJson(
  accessToken: string,
  refreshToken: string | undefined,
  accountId: string | undefined,
  fallbackRefreshToken: string | undefined
): string {
  return JSON.stringify(
    {
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken ?? fallbackRefreshToken ?? "",
        account_id: accountId ?? "",
      },
      last_refresh: new Date().toISOString(),
    },
    null,
    2
  )
}

/**
 * token 刷新后写回授权内容，**尽量保留原格式**（sub2api / auth.json / cliproxy），
 * 只更新其中的凭证字段，避免丢失 sub2api 的 proxies/concurrency 等配置。
 */
function updateCredentialContent(
  original: string,
  fresh: {
    accessToken: string
    refreshToken?: string
    accountId?: string
    expiresAt?: string
  }
): string {
  try {
    const obj = JSON.parse(original) as Record<string, unknown>
    // sub2api：{ accounts: [{ credentials: {...} }] }
    if (Array.isArray(obj.accounts) && obj.accounts[0]) {
      const acc = obj.accounts[0] as Record<string, unknown>
      const cred = (acc.credentials ?? acc) as Record<string, unknown>
      if (cred.access_token !== undefined) {
        cred.access_token = fresh.accessToken
        if (fresh.refreshToken) cred.refresh_token = fresh.refreshToken
        if (fresh.accountId) cred.chatgpt_account_id = fresh.accountId
        if (fresh.expiresAt) cred.expires_at = fresh.expiresAt
        if (typeof acc.credentials === "object") acc.credentials = cred
        return JSON.stringify(obj, null, 2)
      }
    }
    // auth.json：{ tokens: {...} }
    if (obj.tokens && typeof obj.tokens === "object") {
      const t = obj.tokens as Record<string, unknown>
      t.access_token = fresh.accessToken
      if (fresh.refreshToken) t.refresh_token = fresh.refreshToken
      if (fresh.accountId) t.account_id = fresh.accountId
      obj.last_refresh = new Date().toISOString()
      return JSON.stringify(obj, null, 2)
    }
    // cliproxy / CPA：{ access_token, ... } 顶层
    if (obj.access_token !== undefined) {
      obj.access_token = fresh.accessToken
      if (fresh.refreshToken) obj.refresh_token = fresh.refreshToken
      if (fresh.accountId) obj.account_id = fresh.accountId
      if (fresh.expiresAt) obj.expires_at = fresh.expiresAt
      return JSON.stringify(obj, null, 2)
    }
  } catch {
    // 非 JSON（Cookie 文本）→ 兜底
  }
  return buildAuthJson(fresh.accessToken, fresh.refreshToken, fresh.accountId, undefined)
}

/** 解析粘贴内容：JSON（auth.json / sub2api / cliproxy）或 Cookie 文本 */
export function parseCodexContent(content: string): CodexCredential {
  const text = content.trim()
  if (!text) throw new Error("缺少授权内容，请在编辑中粘贴")

  const pick = (c: Record<string, unknown>) => {
    const accountName =
      typeof c.name === "string" && c.name
        ? c.name
        : typeof c.email === "string" && c.email
          ? c.email
          : undefined
    return {
      accountName,
      tokenExpiresAt: c.expires_at
        ? String(c.expires_at)
        : c.access_token_expires_at
          ? String(c.access_token_expires_at)
          : undefined,
      subscriptionExpiresAt: c.subscription_expires_at
        ? String(c.subscription_expires_at)
        : undefined,
      planType: c.plan_type ? String(c.plan_type) : undefined,
    }
  }

  // 1) JSON 形态
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    // auth.json：{ tokens: { access_token, refresh_token, account_id } }
    const tokens = obj.tokens as Record<string, unknown> | undefined
    if (tokens && typeof tokens === "object") {
      const at = tokens.access_token ?? tokens.accessToken
      if (at) {
        return {
          accessToken: String(at),
          accountId: tokens.account_id ? String(tokens.account_id) : undefined,
          refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
          ...pick(tokens),
        }
      }
    }
    // cliproxy / CPA：{ access_token, account_id }
    const atTop = obj.access_token ?? obj.accessToken
    if (atTop) {
      return {
        accessToken: String(atTop),
        accountId: obj.account_id || obj.accountId || obj.chatgpt_account_id
          ? String(obj.account_id ?? obj.accountId ?? obj.chatgpt_account_id)
          : undefined,
        refreshToken: obj.refresh_token ? String(obj.refresh_token) : undefined,
        ...pick(obj),
      }
    }
    // sub2api：{ accounts: [{ name?, credentials: { access_token, email, expires_at, subscription_expires_at, plan_type } }] }
    if (Array.isArray(obj.accounts)) {
      const acc = obj.accounts.find(
        (a): a is Record<string, unknown> =>
          !!a &&
          typeof a === "object" &&
          !!(a as Record<string, unknown>).credentials ||
          !!(a as Record<string, unknown>).access_token
      )
      if (acc) {
        const cred = (acc.credentials as Record<string, unknown> | undefined) ?? acc
        const at2 = cred.access_token ?? cred.accessToken
        if (at2) {
          const extra = pick(cred)
          // 账号名优先取 accounts[i].name（sub2api 导出标配），其次 credentials.email
          return {
            accessToken: String(at2),
            accountId: cred.chatgpt_account_id || cred.account_id
              ? String(cred.chatgpt_account_id ?? cred.account_id)
              : undefined,
            refreshToken: cred.refresh_token ? String(cred.refresh_token) : undefined,
            accountName:
              typeof acc.name === "string" && acc.name ? acc.name : extra.accountName,
            tokenExpiresAt: extra.tokenExpiresAt,
            subscriptionExpiresAt: extra.subscriptionExpiresAt,
            planType: extra.planType,
          }
        }
      }
    }
    throw new Error("JSON 中未找到 access_token（支持的格式：auth.json / sub2api / cliproxy）")
  }

  // 2) Cookie 文本：name=value（; 或换行分隔）
  const pairs: string[] = []
  const re = /([A-Za-z0-9_.-]+)=([^;\s]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    pairs.push(`${m[1]}=${m[2]}`)
  }
  if (pairs.length === 0) {
    throw new Error("无法识别内容：既不是 JSON 也不是 Cookie 文本")
  }
  return { cookieHeader: pairs.join("; ") }
}

/** Cookie → access_token（chatgpt.com 会话交换） */
export async function codexSessionToToken(
  cookieHeader: string
): Promise<{ accessToken: string; accountId?: string }> {
  const data = (await httpGetJson("https://chatgpt.com/api/auth/session", {
    Cookie: cookieHeader,
    "User-Agent": "CodexBar",
    Accept: "application/json",
  })) as { accessToken?: string; user?: { id?: string } }
  if (!data?.accessToken) {
    throw new Error("会话交换失败：未返回 accessToken（Cookie 可能已过期或无效）")
  }
  return { accessToken: data.accessToken, accountId: data.user?.id }
}

/** refresh_token → 新 access_token（auth.openai.com OAuth），可能返回新的 refresh_token */
async function refreshCodexToken(
  refreshToken: string
): Promise<{
  accessToken: string
  accountId?: string
  refreshToken?: string
}> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  })
  const { status, data } = await postForm("https://auth.openai.com/oauth/token", body)
  if (status !== 200) throw new Error(`Token 刷新失败：HTTP ${status}`)
  const accessToken = data.access_token
  if (!accessToken) throw new Error("Token 刷新失败：响应缺少 access_token")
  return {
    accessToken: String(accessToken),
    accountId: data.account_id ? String(data.account_id) : undefined,
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
  }
}

function fmtResetAt(unixSeconds: number): string | undefined {
  const ms = unixSeconds * 1000 - Date.now()
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

function mkWindow(w: Record<string, unknown> | undefined, idx: number, label?: string): QuotaWindow | null {
  if (!w) return null
  const seconds = Number(w.limit_window_seconds) || 0
  const hours = Math.round(seconds / 3600)
  const finalLabel =
    label ??
    (hours === 5 ? "5 小时限额" : hours >= 168 ? "每周限额" : `${hours} 小时限额`)
  return {
    id: `codex-${idx}`,
    label: finalLabel,
    usedPercent: Math.min(100, Math.max(0, Math.round(Number(w.used_percent) || 0))),
    resetIn: w.reset_at ? fmtResetAt(Number(w.reset_at)) : undefined,
  }
}

async function queryWham(
  accessToken: string,
  accountId?: string
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "CodexBar",
  }
  if (accountId) headers["ChatGPT-Account-Id"] = accountId
  return (await httpGetJson("https://chatgpt.com/backend-api/wham/usage", headers)) as Record<
    string,
    unknown
  >
}

/**
 * 账号信息（名称 / 订阅到期）：来自 ChatGPT 网页后端 accounts/check 接口，
 * 与 CodexBar 显示订阅到期时间的做法一致。失败静默（不影响 wham 主链路）。
 * 结果按 accountId 缓存 6 小时，避免每次刷新都打网页接口。
 */
const ACCOUNT_INFO_TTL = 6 * 3600 * 1000
const accountInfoCache = new Map<
  string,
  { name?: string; expiresAt?: string; ts: number }
>()

async function queryAccountInfo(
  accessToken: string,
  accountId?: string
): Promise<{ name?: string; expiresAt?: string }> {
  const cacheKey = accountId ?? accessToken.slice(-12)
  const cached = accountInfoCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < ACCOUNT_INFO_TTL) return cached
  try {
    const data = (await httpGetJson(
      "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27",
      {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "CodexBar",
      }
    )) as Record<string, unknown>

    let name: string | undefined
    let expiresAt: string | undefined

    // 订阅到期：entitlement.expires_at（免费账号为 null）
    const entitlement = (data.entitlement ?? {}) as Record<string, unknown>
    const expiresRaw = entitlement.expires_at
    if (expiresRaw !== undefined && expiresRaw !== null) {
      expiresAt = formatDate(expiresRaw as string | number)
    }
    // 账号名：accounts.default.account.name（可能为 null，回退 JWT email / account_id）
    const defaultAcc = ((data.accounts ?? {}) as Record<string, unknown>)
      .default as Record<string, unknown> | undefined
    const account = (defaultAcc?.account ?? {}) as Record<string, unknown>
    if (account.name) name = String(account.name)
    if (!name) {
      const payload = decodeJwtPayload(accessToken)
      if (payload?.email) name = String(payload.email)
      else if (payload?.name) name = String(payload.name)
      else if (accountId) name = `账号 ${accountId.slice(0, 8)}`
    }

    const entry = { name, expiresAt, ts: Date.now() }
    accountInfoCache.set(cacheKey, entry)
    return entry
  } catch {
    // 静默失败：网页接口被风控/不可用时不阻塞配额查询
    return {}
  }
}

/** 刷新 token；失败时附带原始错误，便于定位根因（如 token 本身无效 vs 网关问题） */
async function safeRefresh(
  refreshToken: string,
  context: string
): Promise<{
  accessToken: string
  accountId?: string
  refreshToken?: string
}> {
  try {
    return await refreshCodexToken(refreshToken)
  } catch (e) {
    const m = e instanceof Error ? e.message : "未知错误"
    throw new Error(`${m}（触发原因：${context}）`)
  }
}

/**
 * 查询 Codex 用量（两层刷新机制）：
 * ① 主动刷新：access_token 过期时间（sub2api 导出的 expires_at，或 JWT exp）临近 < 10 分钟且有 refresh_token 时，先刷新再查询
 * ② 被动刷新：请求返回 401/403 且有 refresh_token 时，刷新一次并重试
 * 刷新成功后按原格式（sub2api / auth.json / cliproxy）写回新凭证（configUpdate），下次刷新继续有效。
 */
async function fetchCodexUsage(
  cred: CodexCredential,
  originalContent: string
): Promise<FetchResult> {
  let accessToken = cred.accessToken!
  let accountId = cred.accountId
  let refreshToken = cred.refreshToken
  let rotated = false

  // ① 主动刷新：token 快过期（优先导出信息里的 expires_at，回退 JWT exp）
  let tokenExp = cred.tokenExpiresAt ? Date.parse(cred.tokenExpiresAt) : NaN
  if (Number.isNaN(tokenExp)) {
    const jwtExp = jwtExpiresAt(accessToken)
    tokenExp = jwtExp !== null ? jwtExp : NaN
  }
  if (refreshToken && !Number.isNaN(tokenExp) && tokenExp - Date.now() < REFRESH_AHEAD_MS) {
    const fresh = await safeRefresh(refreshToken, "access_token 即将过期（主动刷新）")
    accessToken = fresh.accessToken
    accountId = fresh.accountId ?? accountId
    if (fresh.refreshToken) refreshToken = fresh.refreshToken
    rotated = true
  }

  const finish = async (result: FetchResult): Promise<FetchResult> => {
    // 账号名称 / 订阅到期：优先用授权内容里解析出的（sub2api 自带），
    // 缺失时再尝试 accounts/check 补充（失败静默）
    if (!result.accountName) {
      const info = await queryAccountInfo(accessToken, accountId)
      result.accountName = cred.accountName ?? info.name
      result.subscriptionExpiresAt =
        cred.subscriptionExpiresAt !== undefined
          ? formatDate(cred.subscriptionExpiresAt)
          : info.expiresAt
    } else if (cred.subscriptionExpiresAt !== undefined) {
      result.subscriptionExpiresAt = formatDate(cred.subscriptionExpiresAt)
    }
    if (!result.plan && cred.planType) result.plan = cred.planType
    if (rotated) {
      // 新 token 的过期时间（ISO），用于刷新后写回 expires_at
      const expMs = jwtExpiresAt(accessToken)
      const expiresAt = expMs !== null ? new Date(expMs).toISOString() : undefined
      result.configUpdate = {
        content: updateCredentialContent(originalContent, {
          accessToken,
          refreshToken,
          accountId,
          expiresAt,
        }),
      }
    }
    return result
  }

  try {
    return await finish(parseUsage(await queryWham(accessToken, accountId)))
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    // 已主动刷过或没有 refresh_token 或错误不是鉴权类 → 直接抛
    if (rotated || !cred.refreshToken || (!msg.includes("HTTP 401") && !msg.includes("HTTP 403"))) {
      throw e
    }
    // ② 被动刷新：401/403 且未刷过
    const fresh = await safeRefresh(cred.refreshToken, msg)
    accessToken = fresh.accessToken
    accountId = fresh.accountId ?? accountId
    if (fresh.refreshToken) refreshToken = fresh.refreshToken
    rotated = true
    return finish(parseUsage(await queryWham(accessToken, accountId)))
  }
}

function parseUsage(data: Record<string, unknown>): FetchResult {
  const rl = (data.rate_limit ?? {}) as Record<string, unknown>
  const windows: QuotaWindow[] = []
  const w1 = mkWindow(rl.primary_window as Record<string, unknown> | undefined, 0)
  const w2 = mkWindow(rl.secondary_window as Record<string, unknown> | undefined, 1)
  if (w1) windows.push(w1)
  if (w2) windows.push(w2)
  const crl = (data.code_review_rate_limit ?? {}) as Record<string, unknown>
  const w3 = mkWindow(crl.primary_window as Record<string, unknown> | undefined, 2, "代码审查限额")
  if (w3) windows.push(w3)
  if (!windows.length) {
    throw new Error(`响应缺少 rate_limit：${JSON.stringify(data).slice(0, 120)}`)
  }

  const plan = data.plan_type ? String(data.plan_type) : undefined
  const credits = (data.credits ?? {}) as Record<string, unknown> | undefined
  let balance: Balance | undefined
  if (credits && credits.balance !== undefined && credits.balance !== null) {
    const amount = Number(credits.balance)
    if (Number.isFinite(amount) && amount > 0) {
      balance = { amount, currency: "USD" }
    }
  }
  return {
    windows,
    plan,
    balance,
    status: "ok",
    note: credits?.has_credits === false ? "免费档（无付费积分）" : "Codex 实时用量",
  }
}

/** 统一适配器：解析粘贴内容 → 查询用量 */
export function makeCodexAdapter(): Adapter {
  return async (config) => {
    const content = (config.content ?? "").trim()
    const cred = parseCodexContent(content)
    if (cred.accessToken) {
      return fetchCodexUsage(cred, content)
    }
    if (cred.cookieHeader) {
      const session = await codexSessionToToken(cred.cookieHeader)
      return fetchCodexUsage(
        {
          accessToken: session.accessToken,
          accountId: session.accountId,
        },
        content
      )
    }
    throw new Error("无法识别授权内容")
  }
}
