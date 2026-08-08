import { postBinary, postJson } from "@/lib/http"
import {
  encodeStringField,
  encodeVarintField,
  parseProto,
  protoNum,
  protoString,
} from "@/lib/protobuf"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Windsurf（Devin Desktop）· 订阅制（每日/每周配额）
 * 原 Windsurf 已于 2026-06 改名为 Devin Desktop（同属 Cognition/Codeium）。
 * 接入方式（参考 CodexBar）：
 *  - session（推荐）：粘贴浏览器 localStorage 的 Windsurf/Devin session 数据
 *    （sessionToken / auth1Token / accountID / primaryOrgID），走
 *    POST https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/GetPlanStatus
 *    （protobuf 二进制，头部 x-auth-token / x-devin-session-token / x-devin-auth1-token / x-devin-account-id / x-devin-primary-org-id）
 *  - apikey（备选）：sk-ws-01-...，走 server.codeium.com GetUserStatus（JSON）
 */
export const windsurf: VendorDef = {
  id: "windsurf",
  name: "Windsurf（Devin）",
  vendor: "Codeium",
  kind: "subscription",
  authType: "oauth",
  windowTemplates: [
    { id: "ws-daily", label: "每日配额" },
    { id: "ws-weekly", label: "每周配额" },
  ],
  fields: [
    {
      key: "authMethod",
      label: "授权方式",
      required: true,
      options: [
        { value: "session", label: "浏览器 Session" },
        { value: "apikey", label: "API Key (sk-ws-01-)" },
      ],
    },
    {
      key: "content",
      label: "Session 数据",
      placeholder:
        "粘贴浏览器 localStorage 的 Windsurf/Devin session（JSON 或 key=value），含 sessionToken / auth1Token / accountID / primaryOrgID",
      multiline: true,
      secret: true,
      required: true,
      dependsOn: { key: "authMethod", value: "session" },
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "sk-ws-01-...（Windsurf/Devin Desktop 登录后的 API Key）",
      secret: true,
      required: true,
      dependsOn: { key: "authMethod", value: "apikey" },
    },
  ],
}

const PLAN_URL =
  "https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/GetPlanStatus"

interface WsSession {
  sessionToken?: string
  auth1Token?: string
  accountID?: string
  primaryOrgID?: string
}

/** 解析 session 输入：JSON 或 key=value，兼容多种字段别名 */
function parseSession(text: string): WsSession {
  const pick = (obj: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === "string" && v) return v
    }
    return undefined
  }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(text) as Record<string, unknown>
  } catch {
    // key=value 或 key:value 形式
    obj = {}
    const re = /([A-Za-z0-9_]+)\s*[:=]\s*([^\s,;]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      obj[m[1]] = m[2]
    }
  }
  const session = {
    sessionToken: pick(obj, ["sessionToken", "devinSessionToken", "devin_session_token"]),
    auth1Token: pick(obj, ["auth1Token", "devinAuth1Token", "devin_auth1_token"]),
    accountID: pick(obj, ["accountID", "accountId", "devinAccountId", "devin_account_id"]),
    primaryOrgID: pick(obj, ["primaryOrgID", "primaryOrgId", "devinPrimaryOrgId", "devin_primary_org_id"]),
  }
  if (!session.sessionToken) {
    throw new Error("未找到 sessionToken（请粘贴包含 sessionToken / auth1Token / accountID 的登录态数据）")
  }
  return session
}

function fmtReset(unixSec: number | undefined): string | undefined {
  if (unixSec === undefined) return undefined
  const ms = unixSec * 1000 - Date.now()
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

/** Session 方式：GetPlanStatus（protobuf）→ 每日/每周配额 */
async function fetchBySession(session: WsSession): Promise<FetchResult> {
  const req = Buffer.concat([
    encodeStringField(1, session.sessionToken!),
    encodeVarintField(2, 1),
  ])
  const headers: Record<string, string> = {
    "Connect-Protocol-Version": "1",
    Origin: "https://windsurf.com",
    Referer: "https://windsurf.com/profile",
  }
  if (session.sessionToken) {
    headers["x-auth-token"] = session.sessionToken
    headers["x-devin-session-token"] = session.sessionToken
  }
  if (session.auth1Token) headers["x-devin-auth1-token"] = session.auth1Token
  if (session.accountID) headers["x-devin-account-id"] = session.accountID
  if (session.primaryOrgID) headers["x-devin-primary-org-id"] = session.primaryOrgID

  const res = await postBinary(PLAN_URL, req, headers)

  // 解析 protobuf：top.field1 = planStatus
  const top = parseProto(res)
  const planStatusBuf = top.get(1)?.value
  const planStatus = Buffer.isBuffer(planStatusBuf)
    ? parseProto(planStatusBuf)
    : new Map<number, { wire: number; value: number | Buffer }>()
  // planInfo（field1）→ planName（field2）
  let plan: string | undefined
  const planInfoBuf = planStatus.get(1)?.value
  if (Buffer.isBuffer(planInfoBuf)) {
    const planInfo = parseProto(planInfoBuf)
    plan = protoString(planInfo.get(2)?.value)
  }
  const dailyRemain = protoNum(planStatus.get(14)?.value)
  const weeklyRemain = protoNum(planStatus.get(15)?.value)
  const dailyReset = protoNum(planStatus.get(17)?.value)
  const weeklyReset = protoNum(planStatus.get(18)?.value)
  if (dailyRemain === undefined && weeklyRemain === undefined) {
    throw new Error(
      `响应缺少配额字段（session 可能无效或未订阅）：${Buffer.from(res).toString("hex").slice(0, 120)}`
    )
  }
  const windows: QuotaWindow[] = []
  if (dailyRemain !== undefined) {
    windows.push({
      id: "ws-daily",
      label: "每日配额",
      usedPercent: Math.min(100, Math.max(0, Math.round(100 - dailyRemain))),
      resetIn: fmtReset(dailyReset),
    })
  }
  if (weeklyRemain !== undefined) {
    windows.push({
      id: "ws-weekly",
      label: "每周配额",
      usedPercent: Math.min(100, Math.max(0, Math.round(100 - weeklyRemain))),
      resetIn: fmtReset(weeklyReset),
    })
  }
  const result: FetchResult = { windows, status: "ok", note: "Windsurf/Devin Desktop 配额" }
  if (plan) result.plan = plan
  return result
}

/** API Key 方式：server.codeium.com GetUserStatus（credits 制） */
async function fetchByApiKey(key: string): Promise<FetchResult> {
  const data = (await postJson(
    "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
    {
      metadata: {
        apiKey: key,
        ideName: "windsurf",
        ideVersion: "0.0.0",
        extensionName: "windsurf",
        extensionVersion: "0.0.0",
        locale: "en",
      },
    },
    { "Connect-Protocol-Version": "1" }
  )) as {
    userStatus?: {
      planStatus?: {
        planInfo?: { planName?: string }
        availablePromptCredits?: number
        usedPromptCredits?: number
        availableFlexCredits?: number
        usedFlexCredits?: number
      }
    }
  }
  const ps = data.userStatus?.planStatus
  if (!ps || ps.availablePromptCredits === undefined) {
    throw new Error(
      `响应缺少 planStatus（API Key 可能无效）：${JSON.stringify(data).slice(0, 150)}`
    )
  }
  const div = (n?: number) => (typeof n === "number" ? n / 100 : 0)
  const available = div(ps.availablePromptCredits)
  const used = div(ps.usedPromptCredits ?? 0)
  const flexAvailable = div(ps.availableFlexCredits)
  const flexUsed = div(ps.usedFlexCredits ?? 0)
  const pct = (u: number, t: number) =>
    t <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((u / t) * 100)))
  const windows: QuotaWindow[] = []
  if (ps.availablePromptCredits >= 0) {
    windows.push({
      id: "ws-prompt",
      label: "本月 Prompt 额度",
      usedPercent: pct(used, used + available),
      detail: `${used}/${used + available}`,
    })
  }
  if (ps.availableFlexCredits !== undefined && ps.availableFlexCredits >= 0) {
    windows.push({
      id: "ws-flex",
      label: "Flex 额度",
      usedPercent: pct(flexUsed, flexUsed + flexAvailable),
      detail: `${flexUsed}/${flexUsed + flexAvailable}`,
    })
  }
  if (!windows.length) throw new Error("响应缺少可用额度数据")
  const result: FetchResult = { windows, status: "ok", note: "Windsurf 订阅额度" }
  if (ps.planInfo?.planName) result.plan = ps.planInfo.planName
  return result
}

export const adapter: Adapter = async (config) => {
  const authMethod = config.authMethod ?? "session"
  if (authMethod === "apikey") {
    const key = (config.apiKey ?? "").trim()
    if (!key) throw new Error("缺少 API Key，请在编辑中填写")
    return fetchByApiKey(key)
  }
  const content = (config.content ?? "").trim()
  if (!content) throw new Error("缺少 Session 数据，请在编辑中粘贴")
  return fetchBySession(parseSession(content))
}
