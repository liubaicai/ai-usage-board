import { httpGetJson, postForm } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Gemini CLI（Google）· 订阅制
 * 接入方式：粘贴 ~/.gemini/oauth_creds.json 内容（OAuth 凭据，含 refresh_token）
 * 流程：刷新 access_token（oauth2.googleapis.com/token）→
 *   POST cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels（body: {project}）
 *   → models[].quotaInfo.remainingFraction / resetTime
 * project 自动获取：GET cloudresourcemanager.googleapis.com/v1/projects（首个项目），失败需手填。
 */
export const gemini: VendorDef = {
  id: "gemini",
  name: "Gemini",
  vendor: "Google",
  kind: "subscription",
  authType: "oauth",
  fields: [
    {
      key: "content",
      label: "oauth_creds.json 内容",
      placeholder: "粘贴 ~/.gemini/oauth_creds.json 的内容",
      multiline: true,
      secret: true,
      required: true,
    },
    {
      key: "projectId",
      label: "项目 ID（可选）",
      placeholder: "留空自动获取，取不到时需手动填写",
    },
  ],
}

function pickCred(content: string): {
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
} {
  const obj = JSON.parse(content) as Record<string, unknown>
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === "string" && v) return v
    }
    return undefined
  }
  return {
    clientId: pick(["clientId", "client_id"]),
    clientSecret: pick(["clientSecret", "client_secret"]),
    refreshToken: pick(["refreshToken", "refresh_token"]),
    accessToken: pick(["accessToken", "access_token"]),
  }
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  })
  const { status, data } = await postForm("https://oauth2.googleapis.com/token", body)
  if (status !== 200 || !data.access_token) {
    throw new Error(`刷新 access_token 失败：HTTP ${status}`)
  }
  return String(data.access_token)
}

async function getProject(accessToken: string): Promise<string | undefined> {
  try {
    const data = (await httpGetJson(
      "https://cloudresourcemanager.googleapis.com/v1/projects",
      { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    )) as { projects?: { projectId?: string }[] }
    return data.projects?.find((p) => p.projectId)?.projectId
  } catch {
    return undefined
  }
}

export const adapter: Adapter = async (config) => {
  const content = (config.content ?? "").trim()
  if (!content) throw new Error("缺少 oauth_creds.json 内容，请在编辑中粘贴")
  let cred: ReturnType<typeof pickCred>
  try {
    cred = pickCred(content)
  } catch {
    throw new Error("oauth_creds.json 解析失败（应为 JSON）")
  }
  if (!cred.refreshToken && !cred.accessToken) {
    throw new Error("未找到 refresh_token / access_token（请先用 gemini login 登录）")
  }

  // 1) 拿 access_token：优先刷新（有 client_id/secret/refresh），否则用已有 token
  let accessToken = cred.accessToken
  if (cred.refreshToken) {
    if (cred.clientId && cred.clientSecret) {
      accessToken = await refreshAccessToken(
        cred.clientId,
        cred.clientSecret,
        cred.refreshToken
      )
    } else if (!accessToken) {
      throw new Error(
        "oauth_creds.json 缺少 client_id/client_secret，无法刷新 token（请用 gemini CLI 重新登录生成完整凭据）"
      )
    }
  }
  if (!accessToken) throw new Error("无法获取 access_token")

  // 2) project
  const projectId =
    (config.projectId ?? "").trim() || (await getProject(accessToken))
  if (!projectId) {
    throw new Error("无法自动获取项目 ID，请在编辑中填写「项目 ID」")
  }

  // 3) 查配额
  const data = (await httpGetJson(
    "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
  ).catch(() => {
    throw new Error(
      "fetchAvailableModels 请求失败（可能 token 无效或接口变更，请检查凭据与网络）"
    )
  })) as Record<string, unknown>

  // 兼容两种响应容器：{models:{...}} 或直接 models
  const modelsObj =
    (data.models as Record<string, unknown>) ??
    (data as unknown as Record<string, unknown>)

  const rows: { name: string; remaining: number; resetTime?: string }[] = []
  for (const [name, v] of Object.entries(modelsObj)) {
    const qi = (v as Record<string, unknown>)?.quotaInfo as
      | Record<string, unknown>
      | undefined
    const frac = qi?.remainingFraction
    if (typeof frac === "number" && Number.isFinite(frac)) {
      rows.push({
        name,
        remaining: frac,
        resetTime: qi?.resetTime ? String(qi.resetTime) : undefined,
      })
    }
  }
  if (!rows.length) {
    throw new Error(`响应缺少配额数据：${JSON.stringify(data).slice(0, 150)}`)
  }

  // 展示：剩余比例最低的模型 = 当前瓶颈
  rows.sort((a, b) => a.remaining - b.remaining)
  const bottleneck = rows[0]
  const usedPercent = Math.min(100, Math.max(0, Math.round((1 - bottleneck.remaining) * 100)))
  const windows: QuotaWindow[] = [
    {
      id: "gemini-quota",
      label: "Gemini 配额",
      usedPercent,
      resetIn: bottleneck.resetTime
        ? (() => {
            const ms = Date.parse(bottleneck.resetTime) - Date.now()
            if (ms <= 0) return "即将重置"
            const h = Math.floor(ms / 3_600_000)
            const m = Math.floor((ms % 3_600_000) / 60_000)
            return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
          })()
        : undefined,
      detail: bottleneck.name,
    },
  ]
  const result: FetchResult = { windows, status: "ok", note: "Gemini CLI 配额" }
  if (rows.length > 1) {
    result.note = `共 ${rows.length} 个模型，显示最低剩余`
  }
  return result
}
