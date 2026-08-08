import { httpGetJson, postJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * GitHub Copilot · 订阅制
 * 接入方式：
 *  - device-flow：OAuth 设备授权（对话框内完成），授权后自动写入 GitHub token
 *  - pat：粘贴 Fine-grained PAT（需 Plan 读权限）
 * 接口（社区逆向）：
 *   GitHub token → GET api.github.com/copilot_internal/v2/token 换 copilot 会话 token
 *   → GET api.github.com/copilot_internal/user（配额 snapshots：premium_interactions / chat / completions）
 *  PAT 路径：GET api.github.com/users/{user}/settings/billing/premium_request/usage
 */
export const copilot: VendorDef = {
  id: "copilot",
  name: "GitHub Copilot",
  vendor: "GitHub",
  kind: "subscription",
  authType: "oauth",
  oauthFlow: "copilot",
  fields: [
    {
      key: "authMethod",
      label: "授权方式",
      required: true,
      options: [
        { value: "device-flow", label: "GitHub 设备授权（OAuth）" },
        { value: "pat", label: "Fine-grained PAT" },
      ],
    },
    {
      key: "content",
      label: "GitHub Token",
      placeholder: "填 Fine-grained PAT（ghp_/github_pat_ 开头）；设备授权方式无需填写",
      secret: true,
      // 仅 PAT 方式显示输入框；设备授权用下方按钮完成（自动写入）
      dependsOn: { key: "authMethod", value: "pat" },
    },
  ],
}

const GH_API = "https://api.github.com"
const UA = "GitHubCopilotChat/0.35.0"

/** GitHub OAuth token → Copilot 会话 token（先 GET，失败回退 POST） */
async function exchangeCopilotToken(githubToken: string): Promise<string> {
  const baseHeaders = {
    Accept: "application/json",
    "User-Agent": UA,
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
  }
  try {
    const data = (await httpGetJson(`${GH_API}/copilot_internal/v2/token`, {
      ...baseHeaders,
      Authorization: `token ${githubToken}`,
    })) as { token?: string }
    if (data.token) return data.token
  } catch {
    // GET 失败 → 尝试 POST（部分客户端实现用 POST）
  }
  const data = (await postJson(`${GH_API}/copilot_internal/v2/token`, {}, {
    ...baseHeaders,
    Authorization: `Bearer ${githubToken}`,
  })) as { token?: string }
  if (!data.token) {
    throw new Error(
      "交换 Copilot token 失败（GET/POST 均未返回 token）。请检查 GitHub token 是否有效，或改用 Fine-grained PAT 方式"
    )
  }
  return data.token
}

function daysUntil(dateStr: string): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) - Date.now()
  const d = Math.ceil(ms / 86_400_000)
  return d > 0 ? `${d} 天后` : "已重置"
}

/** 内部配额 API：quota_snapshots → 窗口列表 */
function parseQuotaSnapshots(data: Record<string, unknown>): {
  windows: QuotaWindow[]
  plan?: string
} {
  const plan = data.copilot_plan ? String(data.copilot_plan) : undefined
  const resetDate = data.quota_reset_date ? String(data.quota_reset_date) : undefined
  const snaps = (data.quota_snapshots ?? {}) as Record<
    string,
    { entitlement?: number; percent_remaining?: number; quota_remaining?: number; remaining?: number; unlimited?: boolean } | undefined
  >
  const windows: QuotaWindow[] = []
  const mk = (
    id: string,
    label: string,
    s: { entitlement?: number; percent_remaining?: number; quota_remaining?: number; remaining?: number; unlimited?: boolean } | undefined
  ) => {
    if (!s) return
    const unlimited = s.unlimited === true || s.entitlement === -1
    windows.push({
      id,
      label,
      usedPercent: unlimited
        ? 0
        : Math.min(100, Math.max(0, Math.round(100 - (s.percent_remaining ?? 0)))),
      resetIn: resetDate ? daysUntil(resetDate) : undefined,
      detail: unlimited
        ? "无限额度"
        : `${s.quota_remaining ?? s.remaining ?? 0}/${s.entitlement ?? 0}`,
    })
  }
  mk("copilot-premium", "Premium 请求", snaps.premium_interactions)
  mk("copilot-chat", "Chat 额度", snaps.chat)
  mk("copilot-completions", "补全额度", snaps.completions)
  return { windows, plan }
}

export const adapter: Adapter = async (config) => {
  const authMethod = config.authMethod ?? "device-flow"
  const token = (config.content ?? "").trim()
  if (!token) throw new Error("缺少授权凭据，请在编辑中填写")

  // PAT 路径：公开计费 API
  if (authMethod === "pat") {
    const me = (await httpGetJson(`${GH_API}/user`, {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    })) as { login?: string }
    if (!me.login) throw new Error("PAT 无效（无法获取用户名）")
    const usage = (await httpGetJson(
      `${GH_API}/users/${me.login}/settings/billing/premium_request/usage`,
      {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
      }
    )) as { usageItems?: { netQuantity?: number; limit?: number; model?: string }[] }
    const items = usage.usageItems ?? []
    const total = items.reduce((s, i) => s + (i.limit ?? 0), 0)
    const used = items.reduce((s, i) => s + (i.netQuantity ?? 0), 0)
    if (!total) throw new Error("响应缺少用量数据")
    const result: FetchResult = {
      windows: [
        {
          id: "copilot-pat",
          label: "本月 Premium 请求",
          usedPercent: Math.min(100, Math.max(0, Math.round((used / total) * 100))),
          detail: `${used}/${total}`,
        },
      ],
      plan: "Copilot",
      status: "ok",
      note: "GitHub 计费 API",
    }
    return result
  }

  // device-flow：GitHub token → Copilot token → 内部配额 API
  let githubToken: string
  try {
    githubToken = (JSON.parse(token) as { githubToken?: string }).githubToken ?? ""
  } catch {
    githubToken = token
  }
  if (!githubToken) throw new Error("GitHub token 无效")
  const copilotToken = await exchangeCopilotToken(githubToken)
  let quota: Record<string, unknown>
  try {
    quota = (await httpGetJson(`${GH_API}/copilot_internal/user`, {
      Authorization: `Bearer ${copilotToken}`,
      Accept: "application/json",
      "User-Agent": UA,
      "Editor-Version": "vscode/1.107.0",
      "Editor-Plugin-Version": "copilot-chat/0.35.0",
      "Copilot-Integration-Id": "vscode-chat",
    })) as Record<string, unknown>
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("HTTP 401")) {
      throw new Error(
        "HTTP 401：该 GitHub 账号未订阅 GitHub Copilot（配额接口仅对已订阅账号开放）。请先在 github.com/settings/billing 订阅 Copilot Pro / Business 后重试"
      )
    }
    throw e
  }
  const { windows, plan } = parseQuotaSnapshots(quota)
  if (!windows.length) {
    throw new Error(`响应缺少配额数据：${JSON.stringify(quota).slice(0, 150)}`)
  }
  return { windows, plan, status: "ok", note: "GitHub Copilot 实时配额" }
}
