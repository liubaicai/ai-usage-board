import { httpGetText } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * OpenCode（opencode.ai 工作区订阅）· 订阅制
 * 接入方式：粘贴 opencode.ai 网页 Cookie（session cookie）
 * 接口（CodexBar 逆向，server function）：
 *   GET https://opencode.ai/_server?id=<serverId>&args=[...]
 *   Headers: Cookie / X-Server-Id / X-Server-Instance / Origin: opencode.ai / Referer
 *   流程：workspaces（拿 wrk_ ID）→ subscription（args ["wrk_xxx"]）
 * 响应为 text/javascript 序列化对象，正则提取 rollingUsage/weeklyUsage 的 usagePercent + resetInSec。
 */
export const opencode: VendorDef = {
  id: "opencode",
  name: "OpenCode",
  vendor: "OpenCode",
  kind: "subscription",
  authType: "cookie",
  windowTemplates: [
    { id: "oc-5h", label: "5 小时限额" },
    { id: "oc-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "content",
      label: "网页 Cookie",
      placeholder: "粘贴 opencode.ai 的会话 Cookie（含 auth/session 令牌）",
      multiline: true,
      secret: true,
      required: true,
    },
  ],
}

const SERVER = "https://opencode.ai/_server"
const WS_ID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f"
const SUB_ID = "7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

function serverUrl(serverId: string, args: unknown[]): string {
  const params = new URLSearchParams({ id: serverId })
  if (args.length) params.set("args", JSON.stringify(args))
  return `${SERVER}?${params.toString()}`
}

function headers(cookie: string, serverId: string, referer: string): Record<string, string> {
  return {
    Cookie: cookie,
    "X-Server-Id": serverId,
    "X-Server-Instance": `server-fn:${crypto.randomUUID()}`,
    "User-Agent": UA,
    Origin: "https://opencode.ai",
    Referer: referer,
    Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
  }
}

function extractDouble(text: string, field: string, key: string): number | undefined {
  const re = new RegExp(`${field}[^}]*?${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`)
  const m = text.match(re)
  return m ? Number(m[1]) : undefined
}

/** 宽松解析：优先 JSON，失败正则提取 */
function parseSubscription(text: string): { rolling?: QuotaWindow; weekly?: QuotaWindow } {
  // 未登录检测
  if (/(login|sign in|auth\/authorize|not associated with an account|actor of type "public")/i.test(text)) {
    throw new Error("Cookie 无效或未登录（响应提示需要登录），请检查 Cookie 是否过期")
  }
  // 正则提取（text/javascript 序列化对象）
  const rollPct = extractDouble(text, "rollingUsage", "usagePercent")
  const rollReset = extractDouble(text, "rollingUsage", "resetInSec")
  const weekPct = extractDouble(text, "weeklyUsage", "usagePercent")
  const weekReset = extractDouble(text, "weeklyUsage", "resetInSec")

  const fmtReset = (sec?: number) => {
    if (sec === undefined) return undefined
    const ms = sec * 1000
    if (ms <= 0) return "即将重置"
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
  }
  const windows: QuotaWindow[] = []
  if (rollPct !== undefined) {
    windows.push({
      id: "oc-5h",
      label: "5 小时限额",
      usedPercent: Math.min(100, Math.max(0, Math.round(rollPct))),
      resetIn: fmtReset(rollReset),
    })
  }
  if (weekPct !== undefined) {
    windows.push({
      id: "oc-weekly",
      label: "每周限额",
      usedPercent: Math.min(100, Math.max(0, Math.round(weekPct))),
      resetIn: fmtReset(weekReset),
    })
  }
  return { rolling: windows[0], weekly: windows[1] }
}

export const adapter: Adapter = async (config) => {
  const cookie = (config.content ?? "").trim()
  if (!cookie) throw new Error("缺少网页 Cookie，请在编辑中粘贴")

  // 1) 拿工作区列表
  const wsText = await httpGetText(
    serverUrl(WS_ID, []),
    headers(cookie, WS_ID, "https://opencode.ai")
  )
  const wsMatch = wsText.match(/wrk_[A-Z0-9]+/g)
  const workspaceId = config.workspaceId?.trim() || (wsMatch ? wsMatch[0] : undefined)
  if (!workspaceId) {
    throw new Error(
      `未找到工作区 ID（Cookie 可能无效）：${wsText.slice(0, 150)}`
    )
  }

  // 2) 查订阅用量
  const subText = await httpGetText(
    serverUrl(SUB_ID, [workspaceId]),
    headers(cookie, SUB_ID, `https://opencode.ai/workspace/${workspaceId}/billing`)
  )
  const { rolling, weekly } = parseSubscription(subText)
  if (!rolling && !weekly) {
    throw new Error(
      `响应缺少用量字段（Cookie 可能无效或无订阅）：${subText.slice(0, 200)}`
    )
  }
  const windows: QuotaWindow[] = []
  if (rolling) windows.push(rolling)
  if (weekly) windows.push(weekly)
  return { windows, status: "ok", note: "OpenCode 订阅用量", plan: "OpenCode" }
}
