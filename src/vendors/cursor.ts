import { postJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Cursor · 订阅制（用量池）
 * 接入方式：
 *  - access-token：粘贴 Cursor 登录后的 access_token（JWT），可选 refresh_token
 *  - cookie：粘贴 WorkosCursorSessionToken cookie（自动解析出其中的 access_token）
 * 接口（Connect-RPC v1，JSON over HTTP）：
 *   POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage（body {}）
 *   POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo（body {}）
 *   Headers: Authorization: Bearer + Connect-Protocol-Version: 1
 * 用量池：planUsage.totalPercentUsed；金额为 cents。
 */
export const cursor: VendorDef = {
  id: "cursor",
  name: "Cursor",
  vendor: "Cursor",
  kind: "subscription",
  authType: "cookie",
  fields: [
    {
      key: "authMethod",
      label: "授权方式",
      required: true,
      options: [
        { value: "access-token", label: "Access Token（JWT）" },
        { value: "cookie", label: "网页 Cookie" },
      ],
    },
    {
      key: "content",
      label: "授权内容",
      placeholder:
        "Access Token 方式：粘贴 JWT（cursorAuth/accessToken）；Cookie 方式：粘贴 WorkosCursorSessionToken=...",
      multiline: true,
      secret: true,
      required: true,
    },
    {
      key: "refreshToken",
      label: "Refresh Token（可选）",
      placeholder: "cursorAuth/refreshToken，token 过期时自动刷新",
      secret: true,
      dependsOn: { key: "authMethod", value: "access-token" },
    },
  ],
}

const RPC = "https://api2.cursor.sh/aiserver.v1.DashboardService"

/** JWT exp（秒或毫秒） */
function jwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    const json = decodeURIComponent(
      Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    )
    const payload = JSON.parse(json) as { exp?: number }
    return typeof payload.exp === "number" ? (payload.exp > 1e12 ? payload.exp : payload.exp * 1000) : null
  } catch {
    return null
  }
}

async function rpc<T>(method: string, accessToken: string): Promise<T> {
  return (await postJson(
    `${RPC}/${method}`,
    {},
    {
      Authorization: `Bearer ${accessToken}`,
      "Connect-Protocol-Version": "1",
    }
  )) as T
}

export const adapter: Adapter = async (config) => {
  const authMethod = config.authMethod ?? "access-token"
  let raw = (config.content ?? "").trim()
  if (!raw) throw new Error("缺少授权内容，请在编辑中填写")

  // cookie 方式：WorkosCursorSessionToken=<userId>%3A%3A<access_token> → 取 :: 后段
  if (authMethod === "cookie") {
    const m = raw.match(/WorkosCursorSessionToken=([^;]+)/)
    if (m) raw = m[1]
    raw = decodeURIComponent(raw)
    const sep = raw.indexOf("::")
    if (sep >= 0) raw = raw.slice(sep + 2)
  }

  let accessToken = raw
  // 可选：access_token 快过期且有 refresh_token 时刷新
  const refreshToken = (config.refreshToken ?? "").trim()
  const exp = jwtExp(accessToken)
  if (refreshToken && exp !== null && exp - Date.now() < 10 * 60 * 1000) {
    try {
      const r = (await postJson("https://api2.cursor.sh/oauth/token", {
        grant_type: "refresh_token",
        client_id: "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB",
        refresh_token: refreshToken,
      })) as { access_token?: string; shouldLogout?: boolean }
      if (r.access_token && r.shouldLogout !== true) {
        accessToken = r.access_token
      }
    } catch {
      // 刷新失败继续用旧 token 尝试
    }
  }

  // 用量
  const usage = (await rpc<Record<string, unknown>>("GetCurrentPeriodUsage", accessToken)) as {
    planUsage?: {
      totalPercentUsed?: number
      totalSpend?: number
      includedSpend?: number
      bonusSpend?: number
      limit?: number
      remaining?: number
    }
  }
  const pu = usage.planUsage
  if (!pu || pu.totalPercentUsed === undefined) {
    throw new Error(`响应缺少 planUsage：${JSON.stringify(usage).slice(0, 150)}`)
  }
  const pct = Math.min(100, Math.max(0, Math.round(Number(pu.totalPercentUsed) || 0)))
  const dollars = (n?: number) =>
    typeof n === "number" && Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : undefined

  const windows: QuotaWindow[] = [
    {
      id: "cursor-cycle",
      label: "周期用量",
      usedPercent: pct,
      detail: [dollars(pu.totalSpend), pu.limit ? `上限 ${dollars(pu.limit)}` : undefined]
        .filter(Boolean)
        .join(" · "),
    },
  ]

  // 套餐名
  let plan: string | undefined
  try {
    const info = (await rpc<Record<string, unknown>>("GetPlanInfo", accessToken)) as {
      planInfo?: { planName?: string }
    }
    if (info.planInfo?.planName) plan = info.planInfo.planName
  } catch {
    // 套餐名获取失败不阻塞
  }

  const result: FetchResult = {
    windows,
    plan,
    status: "ok",
    note: "Cursor 用量池",
  }
  if (authMethod === "cookie") result.note += "（Cookie 解析）"
  return result
}
