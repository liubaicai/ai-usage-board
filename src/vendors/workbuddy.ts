import { postJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * WorkBuddy（腾讯云 CodeBuddy CN）· 订阅制
 * 接入方式：完整 JSON 导入（access_token / refresh_token / uid / enterprise_id / domain 等）。
 * 查询的是订阅资源包配额（周期配额总量/剩余），与 Codex / Claude Code 的限额形态一致。
 * 接口来源：CockpitTools 项目（jlcodes99/cockpit-tools）公开实现。
 *
 * API 基础地址：https://www.codebuddy.cn
 * - POST /v2/billing/meter/get-dosage-notify  → 用量提醒（dosageNotifyCode/Zh/En）
 * - POST /v2/billing/meter/get-payment-type   → 付费类型
 * - POST /v2/billing/meter/get-user-resource  → 资源包列表（周期配额）
 * - POST /v2/plugin/auth/token/refresh        → token 刷新（用 refresh_token）
 * - GET  /v2/plugin/accounts                  → 账号信息（uid/email/nickname）
 */
export const workbuddy: VendorDef = {
  id: "workbuddy",
  name: "WorkBuddy",
  vendor: "腾讯云 CodeBuddy",
  kind: "subscription",
  authType: "json",
  oauthFlow: "workbuddy",
  fields: [
    {
      key: "authMethod",
      label: "授权方式",
      required: true,
      options: [
        { value: "json", label: "JSON 导入（粘贴授权 JSON）" },
        { value: "oauth", label: "OAuth 授权（浏览器登录）" },
      ],
    },
    {
      key: "content",
      label: "授权 JSON",
      placeholder:
        '粘贴 WorkBuddy 授权 JSON，如：\n{"access_token":"...","refresh_token":"...","uid":"...","email":"...","enterprise_id":"...","domain":"..."}',
      secret: true,
      multiline: true,
      required: true,
      dependsOn: { key: "authMethod", value: "json" },
    },
  ],
}

const API_BASE = "https://www.codebuddy.cn"

/** 包代码常量（与官方 CodeBuddy web client 对齐） */
const PACKAGE_CODE = {
  free: "TCACA_code_001_PqouKr6QWV",
  proMon: "TCACA_code_002_AkiJS3ZHF5",
  proYear: "TCACA_code_003_FAnt7lcmRT",
  gift: "TCACA_code_006_DbXS0lrypC",
  activity: "TCACA_code_007_nzdH5h4Nl0",
  freeMon: "TCACA_code_008_cfWoLwvjU4",
  extra: "TCACA_code_009_0XmEQc2xOf",
} as const

/** 从导入的 JSON 中解析出鉴权所需的字段 */
interface WorkbuddyCredential {
  accessToken: string
  refreshToken?: string
  uid?: string
  email?: string
  nickname?: string
  enterpriseId?: string
  domain?: string
}

function parseCredential(content: string): WorkbuddyCredential {
  const trimmed = content.trim()
  if (!trimmed) throw new Error("缺少授权 JSON，请在编辑中填写")

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // 不是合法 JSON，当作裸 access_token
    return { accessToken: trimmed }
  }

  const accessToken = strVal(obj, ["access_token", "accessToken", "token"])
  if (!accessToken) throw new Error("授权 JSON 缺少 access_token 字段")

  return {
    accessToken,
    refreshToken: strVal(obj, ["refresh_token", "refreshToken"]) || undefined,
    uid: strVal(obj, ["uid"]) || undefined,
    email: strVal(obj, ["email"]) || undefined,
    nickname: strVal(obj, ["nickname", "name"]) || undefined,
    enterpriseId: strVal(obj, ["enterprise_id", "enterpriseId"]) || undefined,
    domain: strVal(obj, ["domain"]) || undefined,
  }
}

/** 从对象中按候选 key 取非空字符串 */
function strVal(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

/** 构建鉴权请求头（Bearer token + 可选 X-User-Id / X-Enterprise-Id / X-Tenant-Id / X-Domain） */
function authHeaders(cred: WorkbuddyCredential): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cred.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
  }
  if (cred.uid) h["X-User-Id"] = cred.uid
  if (cred.enterpriseId) {
    h["X-Enterprise-Id"] = cred.enterpriseId
    h["X-Tenant-Id"] = cred.enterpriseId
  }
  if (cred.domain) h["X-Domain"] = cred.domain
  return h
}

/** 用 refresh_token 刷新 access_token；成功返回新凭证（失败返回 null，降级用原 token） */
async function refreshToken(cred: WorkbuddyCredential): Promise<Partial<WorkbuddyCredential> | null> {
  if (!cred.refreshToken) return null
  try {
    const data = (await postJson(
      `${API_BASE}/v2/plugin/auth/token/refresh`,
      {},
      {
        Authorization: `Bearer ${cred.accessToken}`,
        "X-Refresh-Token": cred.refreshToken,
        "Content-Type": "application/json",
      }
    )) as Record<string, unknown>
    const d = (data.data ?? {}) as Record<string, unknown>
    const newAccessToken = strVal(d, ["accessToken", "access_token"])
    if (!newAccessToken) return null
    return {
      accessToken: newAccessToken,
      refreshToken: strVal(d, ["refreshToken", "refresh_token"]) || cred.refreshToken,
      domain: strVal(d, ["domain"]) || cred.domain,
    }
  } catch {
    return null
  }
}

/** 解析数值（兼容 number / string） */
function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 解析周期配额总量 */
function parseCycleTotal(a: Record<string, unknown>): number {
  return (
    parseNum(a.CycleCapacitySizePrecise) ??
    parseNum(a.CycleCapacitySize) ??
    parseNum(a.CapacitySizePrecise) ??
    parseNum(a.CapacitySize) ??
    0
  )
}

/** 解析周期配额剩余量 */
function parseCycleRemain(a: Record<string, unknown>): number {
  return (
    parseNum(a.CycleCapacityRemainPrecise) ??
    parseNum(a.CycleCapacityRemain) ??
    parseNum(a.CapacityRemainPrecise) ??
    parseNum(a.CapacityRemain) ??
    0
  )
}

/** 解析日期时间字符串为毫秒时间戳 */
function parseDateTimeToEpoch(v: unknown): number | null {
  if (typeof v !== "string") return null
  const text = v.trim()
  if (!text) return null
  const iso = text.includes("T") ? text : text.replace(" ", "T")
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? ts : null
}

/** 解析包名称 */
function resolvePackageName(pkgCode: string | null, pkgName?: string | null): string {
  if (pkgCode === PACKAGE_CODE.extra) return "加量包"
  if (pkgCode === PACKAGE_CODE.activity) return "活动赠送包"
  if (
    pkgCode === PACKAGE_CODE.free ||
    pkgCode === PACKAGE_CODE.gift ||
    pkgCode === PACKAGE_CODE.freeMon
  )
    return "基础体验包"
  if (pkgCode === PACKAGE_CODE.proMon || pkgCode === PACKAGE_CODE.proYear) return "专业版订阅"
  return pkgName || "基础包"
}

/** 资源包记录（从 get-user-resource 响应中提取） */
interface QuotaResource {
  packageCode: string | null
  packageName: string | null
  total: number
  remain: number
  used: number
  usedPercent: number
  cycleEndAt: number | null
  expireAt: number | null
}

/** 将原始资源包记录转为结构化配额 */
function toQuotaResource(raw: Record<string, unknown>): QuotaResource {
  const packageCode = typeof raw.PackageCode === "string" ? raw.PackageCode : null
  const packageName = typeof raw.PackageName === "string" ? raw.PackageName : null
  const cycleEndTime = typeof raw.CycleEndTime === "string" ? raw.CycleEndTime : null
  const deductionEndTime = parseNum(raw.DeductionEndTime)
  const expiredTime = typeof raw.ExpiredTime === "string" ? raw.ExpiredTime : null

  const total = parseCycleTotal(raw)
  const remain = parseCycleRemain(raw)
  const used = Math.max(0, total - remain)
  const usedPercent = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0

  const cycleEndAt = parseDateTimeToEpoch(cycleEndTime)
  const expireAt = deductionEndTime ?? parseDateTimeToEpoch(expiredTime) ?? cycleEndAt

  return { packageCode, packageName, total, remain, used, usedPercent, cycleEndAt, expireAt }
}

/** 从 user-resource 响应中提取活跃资源包列表 */
function extractResources(data: unknown): QuotaResource[] {
  // 路径与 CockpitTools extractResourceAccounts 对齐：
  // root → data → Response → Data → Accounts
  const root = data as Record<string, unknown>
  const d = (root?.data ?? root) as Record<string, unknown>
  const resp = (d?.Response ?? d) as Record<string, unknown>
  const payload = (resp?.Data ?? resp) as Record<string, unknown>
  const accounts = Array.isArray(payload?.Accounts) ? (payload.Accounts as unknown[]) : []
  const list = accounts.filter(
    (a): a is Record<string, unknown> => a != null && typeof a === "object"
  )

  // 返回所有条目，不做 Status 过滤（CockpitTools 的 isActiveResource 过滤在前端展示层做，
  // 且部分账号的 Status 值可能不是 0/3 但仍有效）
  return list.map(toQuotaResource)
}

/** 聚合同类资源包（如多个基础包/多个加量包），合并配额 */
function aggregateGroup(resources: QuotaResource[]): QuotaResource | null {
  if (resources.length === 0) return null
  const total = resources.reduce((s, r) => s + r.total, 0)
  const remain = resources.reduce((s, r) => s + r.remain, 0)
  const used = resources.reduce((s, r) => s + r.used, 0)
  const first = resources[0]
  return {
    packageCode: first.packageCode,
    packageName: first.packageName,
    total,
    remain,
    used,
    usedPercent: total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0,
    cycleEndAt: resources.reduce((max, r) => Math.max(max, r.cycleEndAt ?? 0), 0) || null,
    expireAt: resources.reduce((max, r) => Math.max(max, r.expireAt ?? 0), 0) || null,
  }
}

/** 毫秒时间戳 → "3h 12m" / "12m" / "已过期" 倒计时 */
function formatResetIn(ts: number | null): string | undefined {
  if (!ts) return undefined
  const ms = ts - Date.now()
  if (ms <= 0) return "已过期"
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  return `${m}m`
}

/** 把资源包聚合为 QuotaWindow 列表（同类包合并为一个窗口） */
function resourcesToWindows(resources: QuotaResource[]): QuotaWindow[] {
  if (resources.length === 0) return []

  // 按类型分组
  const isBase = (r: QuotaResource) =>
    r.packageCode === PACKAGE_CODE.free ||
    r.packageCode === PACKAGE_CODE.gift ||
    r.packageCode === PACKAGE_CODE.freeMon ||
    r.packageCode === PACKAGE_CODE.proMon ||
    r.packageCode === PACKAGE_CODE.proYear
  const isExtra = (r: QuotaResource) => r.packageCode === PACKAGE_CODE.extra
  const isActivity = (r: QuotaResource) => r.packageCode === PACKAGE_CODE.activity

  const base = aggregateGroup(resources.filter(isBase))
  const extra = aggregateGroup(resources.filter(isExtra))
  const activity = aggregateGroup(resources.filter(isActivity))
  const others = resources.filter((r) => !isBase(r) && !isExtra(r) && !isActivity(r))

  const mkWindow = (r: QuotaResource, id: string, label: string): QuotaWindow => ({
    id,
    label,
    usedPercent: Math.round(r.usedPercent),
    resetIn: formatResetIn(r.cycleEndAt),
    detail: `${Math.round(r.remain)}/${Math.round(r.total)}`,
  })

  const windows: QuotaWindow[] = []
  if (base) windows.push(mkWindow(base, "base", resolvePackageName(base.packageCode, base.packageName)))
  if (activity) windows.push(mkWindow(activity, "activity", resolvePackageName(activity.packageCode, activity.packageName)))
  if (extra) windows.push(mkWindow(extra, "extra", resolvePackageName(extra.packageCode, extra.packageName)))
  // 其他包各自一个窗口
  others.forEach((r, i) =>
    windows.push(mkWindow(r, `other-${i}`, resolvePackageName(r.packageCode, r.packageName)))
  )

  return windows
}

/** 套餐徽章（从资源包列表推断） */
function resolvePlan(resources: QuotaResource[], paymentType?: string): string | undefined {
  const codes = resources.map((r) => r.packageCode)
  const hasPro = codes.some((c) => c === PACKAGE_CODE.proMon || c === PACKAGE_CODE.proYear)
  const hasGift = codes.some((c) => c === PACKAGE_CODE.gift)
  const pt = (paymentType || "").toLowerCase()
  if (pt.includes("enterprise")) return "ENTERPRISE"
  if (hasPro) return hasGift ? "PRO+TRIAL" : "PRO"
  if (hasGift) return "TRIAL"
  if (resources.length > 0) return "FREE"
  if (pt) return pt.toUpperCase()
  return undefined
}

/** 查询用量并解析为 FetchResult */
async function fetchUsage(cred: WorkbuddyCredential) {
  const headers = authHeaders(cred)

  // 资源包配额（核心数据）
  // 时间格式与 CockpitTools 对齐：本地时间 "YYYY-MM-DD HH:mm:ss"
  const fmtLocal = (d: Date): string => {
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const now = new Date()
  const begin = fmtLocal(now)
  const end = fmtLocal(new Date(now.getFullYear() + 100, now.getMonth(), now.getDate()))

  const userResourceBody = {
    PageNumber: 1,
    PageSize: 100,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    PackageEndTimeRangeBegin: begin,
    PackageEndTimeRangeEnd: end,
  }

  // 三个请求并发
  const [dosageRes, paymentRes, resourceRes] = await Promise.allSettled([
    postJson(`${API_BASE}/v2/billing/meter/get-dosage-notify`, {}, headers),
    postJson(`${API_BASE}/v2/billing/meter/get-payment-type`, {}, headers),
    postJson(`${API_BASE}/v2/billing/meter/get-user-resource`, userResourceBody, headers),
  ])

  // 资源包查询失败是致命错误（没有配额数据无法展示）
  if (resourceRes.status !== "fulfilled") {
    throw new Error(`查询资源包配额失败：${resourceRes.reason?.message ?? resourceRes.reason}`)
  }

  // 检查 API 返回的业务码
  const resourceBody = resourceRes.value as Record<string, unknown>
  const resourceCode = Number(resourceBody.code ?? -1)
  if (resourceCode !== 0 && resourceCode !== 200) {
    const msg = String(resourceBody.message ?? resourceBody.msg ?? "未知错误")
    throw new Error(`资源包查询失败(code=${resourceCode})：${msg}`)
  }

  const resources = extractResources(resourceRes.value)
  if (resources.length === 0) {
    // 输出诊断信息：路径解析结果 + 第一个 Account 完整内容
    const data = (resourceBody.data ?? {}) as Record<string, unknown>
    const response = (data.Response ?? data) as Record<string, unknown>
    const payload = (response.Data ?? response) as Record<string, unknown>
    const accounts = Array.isArray(payload.Accounts) ? payload.Accounts : []
    const firstAccount = accounts[0]
    const allKeys = firstAccount && typeof firstAccount === "object"
      ? Object.keys(firstAccount as Record<string, unknown>).join(", ")
      : "(无)"
    const firstStr = firstAccount ? JSON.stringify(firstAccount) : "(空)"
    throw new Error(
      `未查询到有效资源包。Accounts 数量：${accounts.length}。` +
      `第一个 Account 字段：${allKeys}。内容：${firstStr.slice(0, 600)}`
    )
  }

  // 解析 dosage 提示
  let dosageNotifyZh: string | undefined
  if (dosageRes.status === "fulfilled") {
    const dosageData = ((dosageRes.value as Record<string, unknown>).data ?? {}) as Record<string, unknown>
    dosageNotifyZh =
      typeof dosageData.dosageNotifyZh === "string" ? dosageData.dosageNotifyZh : undefined
  }

  // 解析付费类型
  let paymentType: string | undefined
  if (paymentRes.status === "fulfilled") {
    const paymentData = ((paymentRes.value as Record<string, unknown>).data ?? {}) as Record<string, unknown>
    paymentType =
      typeof paymentData === "string"
        ? paymentData
        : typeof paymentData.paymentType === "string"
          ? paymentData.paymentType
          : undefined
  }

  const windows = resourcesToWindows(resources)
  const plan = resolvePlan(resources, paymentType)
  const warn = windows.some((w) => w.usedPercent >= 80)

  return {
    windows,
    status: warn ? ("warn" as const) : ("ok" as const),
    plan,
    accountName: cred.email || cred.nickname || cred.uid,
    note: dosageNotifyZh,
  }
}

export const adapter: Adapter = async (config) => {
  const content = config.content ?? ""
  const cred = parseCredential(content)

  // 尝试用 refresh_token 查询（失败则降级用原 token）
  let result
  try {
    result = await fetchUsage(cred)
  } catch (e) {
    // 查询失败时尝试刷新 token 后重试一次
    const refreshed = await refreshToken(cred)
    if (refreshed?.accessToken) {
      const newCred = { ...cred, ...refreshed }
      result = await fetchUsage(newCred)
      // 刷新成功，写回新凭证
      const newContent = JSON.stringify({
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken ?? cred.refreshToken,
        uid: cred.uid,
        email: cred.email,
        nickname: cred.nickname,
        enterprise_id: cred.enterpriseId,
        domain: refreshed.domain ?? cred.domain,
      })
      return { ...result, configUpdate: { content: newContent } }
    }
    throw e
  }

  return result
}
