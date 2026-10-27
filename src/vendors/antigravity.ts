import { postForm, postJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import { statusFromWindows, type QuotaWindow, type VendorDef } from "@/lib/types"

/**
 * Google Antigravity（agy CLI）· 订阅制
 * 接入方式：粘贴 agy 登录凭据（Google OAuth JSON，含 refresh_token）：
 *  - macOS:   ~/.gemini/oauth_creds.json                        （扁平格式）
 *  - Linux:   ~/.gemini/antigravity-cli/antigravity-oauth-token  （{token:{...}} 嵌套格式）
 *  - Windows: 系统凭据管理器 → 「Windows 凭据」→ 通用凭据「gemini:antigravity」，
 *     展开后 password 字段即为上述 JSON（可用 README 里的 PowerShell 片段导出）
 * 流程：刷新 access_token（oauth2.googleapis.com/token，默认用 Antigravity 内置 OAuth client）→
 *   POST cloudcode-pa.googleapis.com/v1internal:loadCodeAssist（拿套餐 / 项目 ID）→
 *   POST v1internal:retrieveUserQuotaSummary（分组配额摘要，目前唯一暴露每周限额的接口，
 *     响应 groups[].buckets[].window ∈ {5h, weekly} + remainingFraction/resetTime）
 * 展示：按分组各一行（Gemini / Claude & GPT），行内「5 小时限额」+「每周限额」（真实数据）；
 *   retrieveUserQuotaSummary 不可用时回退 fetchAvailableModels（5h 真实 + 每周占位）。
 * Antigravity 配额为按模型计（fraction 0.0-1.0，1.0 = 全部剩余），5 小时 / 每周窗口。
 */

/**
 * Antigravity 应用内置 OAuth client ID（app bundle 反编译，公开非敏感）。
 * client_secret 属敏感信息，不硬编码进仓库：
 *  - 账号配置字段 clientSecret（优先）
 *  - 环境变量 ANTIGRAVITY_CLIENT_SECRET（部署级，Docker 用 environment 注入）
 * 两者均未提供时明确报错。client_id 默认取内置值，可在账号配置中覆盖。
 */
const DEFAULT_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"

/** 从环境变量读取 Antigravity OAuth client secret（避免密钥进公开仓库） */
function defaultClientSecret(): string | undefined {
  const v = process.env.ANTIGRAVITY_CLIENT_SECRET
  return v && v.trim() ? v.trim() : undefined
}

const CLOUDCODE_BASE_URL = "https://cloudcode-pa.googleapis.com"
const DAILY_CLOUDCODE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com"
/** 内部/自动补全模型黑名单：命中即从展示中剔除（模型集会动态变化，保持容错匹配） */
const INTERNAL_PATTERNS = [/^chat_/i, /^tab_/i, /^rev19/i, /gemini 2\.5/i, /gemini 3 pro image/i]

export const antigravity: VendorDef = {
  id: "antigravity",
  name: "Antigravity",
  vendor: "Google",
  kind: "subscription",
  authType: "json",
  defaultPlan: "Pro",
  // 与 Codex 一致的两行：5 小时限额 + 每周限额（仅 Gemini 组）
  windowTemplates: [
    { id: "antigravity-5h", label: "5 小时限额" },
    { id: "antigravity-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "content",
      label: "agy 登录 token JSON",
      placeholder:
        "macOS: ~/.gemini/oauth_creds.json ｜ Linux: ~/.gemini/antigravity-cli/antigravity-oauth-token ｜ Windows: 凭据管理器「gemini:antigravity」，用 scripts/export-agy-token.ps1 导出",
      multiline: true,
      secret: true,
      required: true,
    },
    {
      key: "clientId",
      label: "OAuth Client ID（可选）",
      placeholder: "默认 Antigravity 内置客户端，一般留空",
    },
    {
      key: "clientSecret",
      label: "OAuth Client Secret（可选）",
      placeholder: "留空则读环境变量 ANTIGRAVITY_CLIENT_SECRET",
      secret: true,
    },
    {
      key: "projectId",
      label: "项目 ID（可选）",
      placeholder: "留空自动从 loadCodeAssist 获取",
    },
  ],
}

interface Creds {
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
  idToken?: string
  /** 凭据里直接带的邮箱（Windows 凭据管理器形态：顶层 id_token_email，无 id_token） */
  email?: string
}

/** 兼容三种凭据形态：Linux 嵌套 {token:{...}}、macOS/Windows 扁平、Gemini oauth_creds 格式 */
function parseCreds(content: string): Creds {
  const obj = JSON.parse(content) as Record<string, unknown>
  const inner =
    obj.token && typeof obj.token === "object"
      ? (obj.token as Record<string, unknown>)
      : obj
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v ? v : undefined
  return {
    clientId: str(obj.clientId) ?? str(obj.client_id),
    clientSecret: str(obj.clientSecret) ?? str(obj.client_secret),
    refreshToken: str(inner.refresh_token) ?? str(obj.refreshToken) ?? str(obj.refresh_token),
    accessToken: str(inner.access_token) ?? str(obj.accessToken) ?? str(obj.access_token),
    idToken: str(obj.id_token) ?? str(inner.id_token),
    // agy 在 Windows 凭据管理器里把邮箱单独存为 id_token_email（不带 id_token 本体）
    email: str(obj.id_token_email) ?? str(inner.id_token_email),
  }
}

/** 从 id_token（JWT）中解出邮箱，用作账号名；失败返回 undefined */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined
  try {
    const payload = idToken.split(".")[1]
    if (!payload) return undefined
    let json: string
    try {
      json = Buffer.from(payload, "base64url").toString("utf8")
    } catch {
      json = Buffer.from(payload, "base64").toString("utf8")
    }
    const data = JSON.parse(json) as { email?: string }
    return data.email
  } catch {
    return undefined
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
    throw new Error(
      `刷新 access_token 失败：HTTP ${status}${data.error_description ? `（${data.error_description}）` : ""}`
    )
  }
  return String(data.access_token)
}

/** 拉取套餐与项目 ID（loadCodeAssist）；失败仅告警，不阻断配额查询 */
async function loadCodeAssist(accessToken: string): Promise<{
  projectId?: string
  plan?: string
}> {
  try {
    const data = (await postJson(
      `${CLOUDCODE_BASE_URL}/v1internal:loadCodeAssist`,
      {
        metadata: {
          ideType: "ANTIGRAVITY",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
        },
      },
      {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CLI_UA,
      }
    )) as Record<string, unknown>
    const proj = data.cloudaicompanionProject as
      | Record<string, unknown>
      | undefined
    const projectId =
      (typeof proj?.projectId === "string" ? proj.projectId : undefined) ??
      (typeof proj?.id === "string" ? proj.id : undefined) ??
      (typeof proj?.name === "string" ? proj.name : undefined)
    const tier = data.currentTier as Record<string, unknown> | undefined
    const planInfo = data.planInfo as Record<string, unknown> | undefined
    const plan =
      (typeof tier?.name === "string" ? tier.name : undefined) ??
      (typeof planInfo?.planName === "string" ? planInfo.planName : undefined) ??
      (typeof planInfo?.name === "string" ? planInfo.name : undefined)
    return { projectId, plan }
  } catch {
    // loadCodeAssist 对部分账户/网络不可用，配额主查询仍可继续（project 可留空）
    return {}
  }
}

interface ModelRow {
  id: string
  displayName: string
  remaining: number
  resetTime?: string
}

/** 查询各模型配额；base URL 主备切换（daily → 正式） */
async function fetchAvailableModels(
  accessToken: string,
  projectId?: string
): Promise<ModelRow[]> {
  const body = projectId ? { project: projectId } : {}
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    // 同 UA 门控：版本过低会拿不到 Gemini 3.8 / 4 系列模型，回退结果会失真
    "User-Agent": ANTIGRAVITY_CLI_UA,
  }
  let data: Record<string, unknown>
  try {
    data = (await postJson(
      `${CLOUDCODE_BASE_URL}/v1internal:fetchAvailableModels`,
      body,
      headers
    )) as Record<string, unknown>
  } catch {
    data = (await postJson(
      `${DAILY_CLOUDCODE_BASE_URL}/v1internal:fetchAvailableModels`,
      body,
      headers
    )) as Record<string, unknown>
  }
  const models = data.models as Record<string, unknown> | undefined
  if (!models) {
    throw new Error(`fetchAvailableModels 响应缺少 models：${JSON.stringify(data).slice(0, 150)}`)
  }
  const rows: ModelRow[] = []
  for (const [id, v] of Object.entries(models)) {
    const info = v as Record<string, unknown> | undefined
    if (!info) continue
    if (info.isInternal === true) continue
    const displayName = typeof info.displayName === "string" ? info.displayName : ""
    if (!displayName) continue
    if (INTERNAL_PATTERNS.some((re) => re.test(displayName) || re.test(id))) continue
    const qi = info.quotaInfo as Record<string, unknown> | undefined
    const frac = qi?.remainingFraction
    if (typeof frac !== "number" || !Number.isFinite(frac)) continue
    rows.push({
      id,
      displayName,
      remaining: frac,
      resetTime: typeof qi?.resetTime === "string" ? qi.resetTime : undefined,
    })
  }
  return rows
}

function formatResetIn(resetTime?: string): string | undefined {
  if (!resetTime) return undefined
  const ms = Date.parse(resetTime) - Date.now()
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

/**
 * 分组配额摘要接口（管理界面 Cli-Proxy-API-Management-Center 实证）：
 * POST /v1internal:retrieveUserQuotaSummary → { groups: [{ displayName, buckets:
 * [{ window: "5h"|"weekly", remainingFraction, resetTime, displayName }] }] }
 * 这是唯一暴露「每周限额」的公开接口；三 URL 主备切换，UA 仿官方 CLI。
 */
const QUOTA_SUMMARY_URLS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
]

/**
 * 仿官方 CLI 的 User-Agent —— **同时是服务端的能力开关**，不是装饰。
 * 实测（2026-10，同一 access_token，仅改 UA）：
 *  - 无 UA → 403；UA=antigravity / 版本 < 1.1.12 → 只下发 1 个组（Claude and GPT models），
 *    不含 Gemini 组，于是取不到 Gemini 配额，卡片恒显 0%；
 *  - 版本 ≥ 1.1.12 → 下发 2 个组（Gemini Models + Claude and GPT models）。
 * 服务端只比对版本号，不校验 os_type / arch。故此处取当前 CLI 版本，勿回退小版本。
 */
const ANTIGRAVITY_CLI_UA =
  "antigravity/cli/1.4.8 (aidev_client; os_type=darwin; arch=arm64)"

interface QuotaBucket {
  /** 稳定标识：gemini-weekly / gemini-5h / 3p-weekly / 3p-5h */
  bucketId?: string
  window?: string
  remainingFraction?: number
  resetTime?: string
  displayName?: string
}

interface QuotaGroup {
  displayName?: string
  description?: string
  buckets?: QuotaBucket[]
}

async function fetchQuotaSummary(
  accessToken: string,
  projectId?: string
): Promise<QuotaGroup[]> {
  let lastErr: unknown
  for (const url of QUOTA_SUMMARY_URLS) {
    try {
      const data = (await postJson(
        url,
        projectId ? { project: projectId } : {},
        {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": ANTIGRAVITY_CLI_UA,
        }
      )) as Record<string, unknown>
      const groups = data.groups
      if (Array.isArray(groups) && groups.length) {
        return groups as QuotaGroup[]
      }
      // 兼容个别账号/版本只在顶层返回 buckets（无 groups）的形态
      const topBuckets = data.buckets
      if (Array.isArray(topBuckets) && topBuckets.length) {
        return [{ displayName: "Quota", buckets: topBuckets as QuotaBucket[] }]
      }
      lastErr = new Error("响应缺少 groups")
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error("retrieveUserQuotaSummary 请求失败")
}

/**
 * 按 window 取值（5h / weekly 等）取组内配额桶。
 * 服务端可能给 window 精确值，也可能只在 bucketId 里体现周期（gemini-5h / 3p-weekly），
 * 故两处都做包含匹配，避免再次因命名变化取不到桶。
 */
function pickBucket(group: QuotaGroup | undefined, windows: string[]): QuotaBucket | undefined {
  if (!group) return undefined
  const buckets = Array.isArray(group.buckets) ? group.buckets : []
  const norm = (w: string | undefined) => (w ?? "").trim().toLowerCase()
  const hit = (b: QuotaBucket) => {
    const fields = [norm(b.window), norm(b.bucketId)]
    return windows.some((w) => fields.some((f) => f === w || (f !== "" && f.includes(w))))
  }
  return buckets.find(hit)
}

/** 分组名归一：Gemini / Claude & GPT 两类，其余保留服务端原名 */
function groupLabel(g: QuotaGroup): string {
  const name = (g.displayName ?? "").trim()
  const hint = `${name} ${g.description ?? ""}`
  if (/gemini/i.test(name)) return "Gemini"
  if (/claude|gpt|3p/i.test(name)) return "Claude & GPT"
  if (/gemini/i.test(hint)) return "Gemini"
  return name || "Quota"
}

interface GroupWindows {
  group: string
  windows: QuotaWindow[]
}

/**
 * 每个分组各产出「5 小时限额」+「每周限额」两个窗口（真实数据）。
 * 仅一个分组时不打 group 标记，保持原有两行竖排布局；
 * 多个分组时带 group 标记，前端 / TUI 各自按组同行渲染（Gemini / Claude & GPT）。
 */
function buildSummaryWindows(
  groups: QuotaGroup[]
): { windows: QuotaWindow[]; note: string } | null {
  const frac = (b: QuotaBucket | undefined) =>
    typeof b?.remainingFraction === "number" && Number.isFinite(b.remainingFraction)
      ? b.remainingFraction
      : null
  const toPercent = (f: number) => Math.min(100, Math.max(0, Math.round((1 - f) * 100)))

  const perGroup: GroupWindows[] = []
  for (const g of groups) {
    const b5 = pickBucket(g, ["5h", "five-hour", "five_hour", "fivehour"])
    const bWeek = pickBucket(g, ["weekly", "week", "7d"])
    const f5 = frac(b5)
    const fw = frac(bWeek)
    const group = groupLabel(g)
    const windows: QuotaWindow[] = []
    if (f5 !== null) {
      windows.push({
        id: "antigravity-5h",
        label: "5 小时限额",
        usedPercent: toPercent(f5),
        resetIn: formatResetIn(b5?.resetTime),
      })
    }
    if (fw !== null) {
      windows.push({
        id: "antigravity-weekly",
        label: "每周限额",
        usedPercent: toPercent(fw),
        resetIn: formatResetIn(bWeek?.resetTime),
      })
    }
    if (windows.length) perGroup.push({ group, windows })
  }
  if (!perGroup.length) return null

  // 单分组：沿用旧布局（不写 group），保持卡片外观不变
  if (perGroup.length === 1) {
    const only = perGroup[0]
    return { windows: only.windows, note: `${only.group} · 分组配额` }
  }

  // 多分组：Gemini 组排最前（用户主要看 Gemini），其余按服务端顺序
  const ordered = [...perGroup].sort((a, b) => {
    const rank = (g: string) => (g === "Gemini" ? 0 : g === "Claude & GPT" ? 1 : 2)
    return rank(a.group) - rank(b.group)
  })
  const windows: QuotaWindow[] = []
  ordered.forEach((entry, gi) => {
    const slug = entry.group
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    for (const w of entry.windows) {
      // 首个分组保留模板 id（后端 / 公开 API 的窗口匹配仍能命中），其余加后缀保证唯一
      const keepId = gi === 0
      windows.push({
        ...w,
        id: keepId ? w.id : `antigravity-${slug || gi}-${w.id.replace("antigravity-", "")}`,
        group: entry.group,
      })
    }
  })
  return { windows, note: ordered.map((e) => e.group).join(" / ") + " 分组配额" }
}

export const adapter: Adapter = async (config) => {
  const content = (config.content ?? "").trim()
  if (!content) throw new Error("缺少 agy 登录 token JSON，请在编辑中粘贴")
  let cred: Creds
  try {
    cred = parseCreds(content)
  } catch {
    throw new Error("token JSON 解析失败（应为合法 JSON，见字段提示）")
  }
  if (!cred.refreshToken && !cred.accessToken) {
    throw new Error("未找到 refresh_token / access_token（请先用 agy 登录一次）")
  }

  // 1) access_token：优先刷新；client 优先级 = 配置字段 > 凭据内 > 默认（clientId 内置 / clientSecret 环境变量）
  const clientId = (config.clientId ?? "").trim() || cred.clientId || DEFAULT_CLIENT_ID
  const clientSecret =
    (config.clientSecret ?? "").trim() || cred.clientSecret || defaultClientSecret()
  if (cred.refreshToken && !clientSecret) {
    throw new Error(
      "缺少 OAuth Client Secret：请在编辑中填写，或设置环境变量 ANTIGRAVITY_CLIENT_SECRET"
    )
  }
  let accessToken = cred.accessToken
  if (cred.refreshToken) {
    accessToken = await refreshAccessToken(clientId, clientSecret as string, cred.refreshToken)
  }
  if (!accessToken) throw new Error("无法获取 access_token")

  // 2) 套餐与项目 ID
  const { projectId: autoProject, plan } = await loadCodeAssist(accessToken)
  const projectId = (config.projectId ?? "").trim() || autoProject

  // 3) 优先用分组配额摘要接口（目前唯一暴露「每周限额」的接口）
  let summaryResult: { windows: QuotaWindow[]; note: string } | null = null
  try {
    const groups = await fetchQuotaSummary(accessToken, projectId)
    summaryResult = buildSummaryWindows(groups)
  } catch (e) {
    // 接口不可用时回退到逐模型查询
    summaryResult = null
  }

  let windows: QuotaWindow[]
  let note: string
  let result: FetchResult
  if (summaryResult) {
    windows = summaryResult.windows
    note = summaryResult.note
    result = { windows, plan: plan || undefined, status: statusFromWindows(windows), note }
  } else {
    // 4) 回退：fetchAvailableModels，只统计 Gemini 模型，5h 取剩余最低者；每周占位
    const rows = await fetchAvailableModels(accessToken, projectId)
    if (!rows.length) {
      throw new Error("响应中未发现带配额的用户模型（可能接口变更或 token 无权限）")
    }
    let geminiRows = rows.filter(
      (r) => /gemini/i.test(r.displayName) || /gemini/i.test(r.id)
    )
    const geminiOnly = geminiRows.length > 0
    if (!geminiOnly) geminiRows = rows
    geminiRows.sort((a, b) => a.remaining - b.remaining)
    const bottleneck = geminiRows[0]
    windows = [
      {
        id: "antigravity-5h",
        label: "5 小时限额",
        usedPercent: Math.min(100, Math.max(0, Math.round((1 - bottleneck.remaining) * 100))),
        resetIn: formatResetIn(bottleneck.resetTime),
        detail: geminiOnly ? "Gemini 模型" : "非 Gemini 模型",
      },
    ]
    note = geminiOnly
      ? `Gemini ${geminiRows.length} 个模型，取剩余最低显示`
      : "未发现 Gemini 模型，已降级显示全部模型"
    result = { windows, plan: plan || undefined, status: statusFromWindows(windows), note }
  }

  const email = cred.email ?? emailFromIdToken(cred.idToken)
  if (email) result.accountName = email
  return result
}
