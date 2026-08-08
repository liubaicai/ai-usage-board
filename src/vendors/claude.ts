import { httpGetJson, postForm } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Claude Code（Anthropic 订阅）· 订阅制
 * 接入方式：粘贴 ~/.claude/.credentials.json 内容（OAuth 凭证）
 * 接口（社区逆向，Claude Code HUD 内部使用）：
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Headers: Authorization: Bearer <accessToken> + anthropic-beta: oauth-2025-04-20
 *   Response: { five_hour: { utilization, resets_at }, seven_day: {...}, seven_day_opus?: {...} }
 * 注意：只有订阅（Pro/Max）才有数据，API Key 用户返回无用量。
 */
export const claude: VendorDef = {
  id: "claude",
  name: "Claude Code",
  vendor: "Anthropic",
  kind: "subscription",
  authType: "oauth",
  windowTemplates: [
    { id: "claude-5h", label: "5 小时限额" },
    { id: "claude-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "content",
      label: "credentials.json 内容",
      placeholder: "粘贴 ~/.claude/.credentials.json 的内容",
      multiline: true,
      secret: true,
      required: true,
    },
  ],
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const BETA_HEADER = "anthropic-beta: oauth-2025-04-20"

/** 解析 ~/.claude/.credentials.json */
function parseCredentials(content: string): {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  subscriptionType?: string
  apiKey?: string
} {
  const obj = JSON.parse(content) as Record<string, unknown>
  const oauth = (obj.claudeAiOauth ?? {}) as Record<string, unknown>
  const expiresAt = oauth.expiresAt
    ? Date.parse(String(oauth.expiresAt))
    : NaN
  return {
    accessToken: oauth.accessToken ? String(oauth.accessToken) : undefined,
    refreshToken: oauth.refreshToken ? String(oauth.refreshToken) : undefined,
    expiresAt: Number.isNaN(expiresAt) ? undefined : expiresAt,
    subscriptionType: oauth.subscriptionType ? String(oauth.subscriptionType) : undefined,
    apiKey: obj.apiKey ? String(obj.apiKey) : undefined,
  }
}

function mkWindow(
  u: { utilization?: number; resets_at?: string } | undefined,
  idx: number,
  label: string
): QuotaWindow | null {
  if (!u || u.utilization === undefined) return null
  return {
    id: `claude-${idx}`,
    label,
    usedPercent: Math.min(100, Math.max(0, Math.round(Number(u.utilization)))),
    resetIn: u.resets_at
      ? (() => {
          const ms = Date.parse(u.resets_at) - Date.now()
          if (ms <= 0) return "即将重置"
          const h = Math.floor(ms / 3_600_000)
          const m = Math.floor((ms % 3_600_000) / 60_000)
          return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
        })()
      : undefined,
  }
}

async function queryUsage(accessToken: string): Promise<Record<string, unknown>> {
  return (await httpGetJson(USAGE_URL, {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json",
  })) as Record<string, unknown>
}

export const adapter: Adapter = async (config) => {
  const content = (config.content ?? "").trim()
  if (!content) throw new Error("缺少 credentials.json 内容，请在编辑中粘贴")
  let cred: ReturnType<typeof parseCredentials>
  try {
    cred = parseCredentials(content)
  } catch {
    throw new Error("credentials.json 解析失败（应为 JSON，含 claudeAiOauth.accessToken）")
  }
  if (!cred.accessToken) {
    throw new Error("未找到 claudeAiOauth.accessToken（请确认已用 Claude Code 登录）")
  }

  let accessToken = cred.accessToken
  // token 临近过期且有 refresh_token 时尝试刷新（失败静默，继续用旧 token 试）
  if (cred.refreshToken && cred.expiresAt && cred.expiresAt - Date.now() < 10 * 60 * 1000) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
      })
      const { status, data } = await postForm(
        "https://api.anthropic.com/api/oauth/token",
        body
      )
      if (status === 200 && data.access_token) {
        accessToken = String(data.access_token)
      }
    } catch {
      // 刷新失败不影响主查询尝试
    }
  }

  const data = (await queryUsage(accessToken)) as {
    five_hour?: { utilization?: number; resets_at?: string }
    seven_day?: { utilization?: number; resets_at?: string }
    seven_day_opus?: { utilization?: number; resets_at?: string }
  }
  const windows: QuotaWindow[] = []
  const w1 = mkWindow(data.five_hour, 0, "5 小时限额")
  const w2 = mkWindow(data.seven_day, 1, "每周限额")
  if (w1) windows.push(w1)
  if (w2) windows.push(w2)
  const w3 = mkWindow(data.seven_day_opus, 2, "每周 Opus 限额")
  if (w3) windows.push(w3)
  if (!windows.length) {
    throw new Error(
      `响应缺少用量数据（订阅账号才有）：${JSON.stringify(data).slice(0, 150)}`
    )
  }
  const result: FetchResult = {
    windows,
    status: "ok",
    note: "Claude Code 订阅用量",
  }
  if (cred.subscriptionType) result.plan = cred.subscriptionType
  return result
}
