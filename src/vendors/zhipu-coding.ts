import { authGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * GLM Coding Plan（智谱编码套餐）· 订阅制
 * 接入方式：API Key（**裸 Key 鉴权，不带 Bearer 前缀**）；
 * 区域可选：国内站 / 国际站(z.ai) / 国内团队版（需团队 ID + 项目 ID）。
 * 查询的是订阅配额（5 小时窗口 / 每周窗口），与 Codex / Claude Code 的限额形态一致。
 * 接口来源：cc-switch 项目公开脚本（farion1231/cc-switch#1588、v3.17.0 团队版说明）。
 */
export const zhipuCoding: VendorDef = {
  id: "zhipu-coding",
  name: "GLM Coding Plan",
  vendor: "智谱 AI",
  kind: "subscription",
  authType: "apikey",
  fields: [
    {
      key: "region",
      label: "区域",
      required: true,
      options: [
        { value: "cn", label: "国内站 open.bigmodel.cn" },
        { value: "intl", label: "国际站 api.z.ai" },
        { value: "team", label: "国内团队版（需团队ID·项目ID）" },
      ],
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "Coding Plan 的 API Key（id.secret）",
      secret: true,
      required: true,
    },
    {
      key: "teamId",
      label: "团队 ID（organization）",
      placeholder: "请求头 bigmodel-organization 对应的团队 ID",
      required: true,
      dependsOn: { key: "region", value: "team" },
    },
    {
      key: "projectId",
      label: "项目 ID（project）",
      placeholder: "请求头 bigmodel-project 对应的项目 ID",
      required: true,
      dependsOn: { key: "region", value: "team" },
    },
  ],
}

const BASE: Record<string, string> = {
  cn: "https://open.bigmodel.cn",
  intl: "https://api.z.ai",
  team: "https://open.bigmodel.cn",
}

/** nextResetTime(毫秒时间戳) → "3h 12m" 倒计时 */
function formatResetIn(ts: number): string {
  const ms = ts - Date.now()
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

/**
 * 用量/配额查询：GET {base}/api/monitor/usage/quota/limit（裸 Key）
 * 个人版：无额外参数；团队版：追加 ?type=2 与请求头 bigmodel-organization / bigmodel-project
 * 响应示例：
 * { "code": 200, "msg": "操作成功", "success": true, "data": {
 *   "level": "pro",
 *   "limits": [
 *     { "type": "TIME_LIMIT", "percentage": 7, "usage": 1000,
 *       "currentValue": 72, "remaining": 928 },
 *     { "type": "TOKENS_LIMIT", "percentage": 44, "nextResetTime": ... },  // 5h 窗口
 *     { "type": "TOKENS_LIMIT", "percentage": 53, "nextResetTime": ... }   // 每周窗口
 *   ] } }
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  const region = config.region ?? "cn"
  const base = BASE[region] ?? BASE.cn
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")

  // 团队版：?type=2 + 组织/项目两个请求头（参考 cc-switch v3.17.0 团队模板）
  let url = `${base}/api/monitor/usage/quota/limit`
  const extraHeaders: Record<string, string> = {}
  if (region === "team") {
    const teamId = config.teamId?.trim()
    const projectId = config.projectId?.trim()
    if (!teamId || !projectId) {
      throw new Error("团队版需要同时填写团队 ID 与项目 ID")
    }
    url += "?type=2"
    extraHeaders["bigmodel-organization"] = teamId
    extraHeaders["bigmodel-project"] = projectId
  }

  const data = (await authGetJson(url, key, {
    raw: true,
    headers: extraHeaders,
  })) as {
    code?: number
    success?: boolean
    msg?: string
    data?: {
      level?: string
      limits?: {
        type: string
        percentage?: number
        nextResetTime?: number
        usage?: number
        currentValue?: number
        remaining?: number
        number?: number
      }[]
    }
  }
  if (data.success !== true || data.code !== 200 || !data.data) {
    throw new Error(`接口异常：${data.msg ?? JSON.stringify(data).slice(0, 120)}`)
  }
  const d = data.data

  // TOKENS_LIMIT 按重置时间升序 → 5 小时窗口、每周窗口
  const tokens = (d.limits ?? [])
    .filter((l) => l.type === "TOKENS_LIMIT")
    .sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0))
  const mkWindow = (
    l: NonNullable<NonNullable<typeof d.limits>[number]>,
    label: string
  ): QuotaWindow => ({
    id: `${l.type}-${label}`,
    label,
    usedPercent: Math.round(l.percentage ?? 0),
    resetIn: l.nextResetTime ? formatResetIn(l.nextResetTime) : undefined,
    detail:
      l.remaining !== undefined && l.number !== undefined
        ? `${l.remaining}/${l.number}`
        : l.usage !== undefined && l.currentValue !== undefined
          ? `${l.currentValue}/${l.usage}`
          : undefined,
  })

  const windows: QuotaWindow[] = []
  if (tokens[0]) windows.push(mkWindow(tokens[0], "5 小时限额"))
  if (tokens[1]) windows.push(mkWindow(tokens[1], "每周限额"))
  // 兜底：没有 TOKENS_LIMIT 时用 TIME_LIMIT 作为 5 小时窗口
  if (!tokens.length) {
    const tl = (d.limits ?? []).find((l) => l.type === "TIME_LIMIT")
    if (tl) windows.push(mkWindow(tl, "5 小时窗口"))
  }
  if (!windows.length) {
    throw new Error(`响应缺少 limits：${JSON.stringify(d).slice(0, 120)}`)
  }

  const warn = windows.some((w) => w.usedPercent >= 85)
  return {
    windows,
    status: warn ? "warn" : "ok",
    plan: d.level ? `Coding ${d.level}` : undefined,
    note: `套餐 ${d.level ?? "unknown"} · MCP 月度配额见控制台`,
  }
}
