/**
 * 核心类型：厂商目录（VendorDef）与账号实例（Account）分离。
 * 同一种厂商可以接入多个账号（多个 Account 指向同一个 vendorId）。
 *
 * 后续接入真实查询时，每种 authType 对应一个适配器：
 * - cookie:    网页会话（Kimi 等）
 * - apikey:    单 Key（DeepSeek / GLM / SiliconFlow…）
 * - json:      导入授权 JSON（Codex auth.json）
 * - oauth:     设备授权 / 网页登录回调（Claude Code）
 * - key+org:   Key + OrgID（阿里云百炼等）
 */
export type AuthType = "cookie" | "apikey" | "json" | "oauth" | "key+org"

export type ProviderKind = "subscription" | "payg"

export type ProviderStatus = "ok" | "warn" | "error"

/** 厂商配置表单中的一个字段 */
export interface ConfigField {
  key: string
  label: string
  placeholder?: string
  /** 密码框显示 */
  secret?: boolean
  /** 多行文本（cookie / json 授权内容） */
  multiline?: boolean
  required?: boolean
  /** 下拉选择（如国内/国际站区域） */
  options?: { value: string; label: string }[]
  /** 条件显示：仅当 config[key] 命中 value（或 values 之一）时该字段才展示并参与必填校验 */
  dependsOn?: { key: string; value?: string; values?: string[] }
}

/** 订阅制限额窗口模板（厂商级） */
export interface WindowTemplate {
  id: string
  label: string
}

/** 厂商目录条目：一种可接入的供应商 */
export interface VendorDef {
  id: string
  name: string
  vendor: string
  kind: ProviderKind
  authType: AuthType
  defaultPlan?: string
  currency?: "CNY" | "USD"
  windowTemplates?: WindowTemplate[]
  /** 可选：设备授权流程标识（Codex / Copilot），存在时对话框渲染 OAuth 授权面板 */
  oauthFlow?: "codex" | "copilot" | "workbuddy"
  fields: ConfigField[]
}

/** 订阅制的限额窗口实例：5 小时 / 每周 / 每月 */
export interface QuotaWindow {
  id: string
  label: string
  usedPercent: number
  resetIn?: string
  detail?: string
}

/** 按量付费余额 */
export interface Balance {
  amount: number
  currency: "CNY" | "USD"
  granted?: number
  totalBalance?: number
}

/** 账号实例：一张卡片 */
export interface Account {
  id: string
  vendorId: string
  /** 账号名称（自定义名），用于区分同厂商多账号 */
  label: string
  plan?: string
  /** 账号真实名称（如 Codex 授权解析出的邮箱 / 用户名），用于区分多账号 */
  accountName?: string
  /** 订阅到期时间（格式化后的日期字符串，如 2026-09-08），仅订阅制厂商有 */
  subscriptionExpiresAt?: string
  /** 按厂商 ConfigField.key 存放的配置值 */
  config: Record<string, string>
  /** 单卡刷新间隔（秒）。null = 跟随全局；0 = 手动 */
  refreshSec: number | null
  status: ProviderStatus
  windows?: QuotaWindow[]
  balance?: Balance
  note?: string
  /** 上次刷新时间戳（ms） */
  lastFetched: number
  updatedAt: string
}

/** 密钥字段"已保存"哨兵：后端返回给前端的占位值，编辑时留空表示保持不变 */
export const KEEP_SECRET = "__KEEP__"

/** 全局设置 */
export interface AppSettings {
  globalRefreshSec: number
}

/** 创建/更新账号的请求体（不含用量字段，由后端生成或保留） */
export interface AccountInput {
  vendorId: string
  label: string
  plan?: string
  config: Record<string, string>
  refreshSec: number | null
}

/** GET /api/state 的响应 */
export interface StateResponse {
  accounts: Account[]
  settings: AppSettings
}


export const AUTH_LABEL: Record<AuthType, string> = {
  cookie: "COOKIE",
  apikey: "API KEY",
  json: "JSON",
  oauth: "OAUTH",
  "key+org": "KEY+ORG",
}

/** 刷新间隔选项（秒）。inherit 仅用于单卡设置 */
export const REFRESH_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "30 秒" },
  { value: "60", label: "1 分钟" },
  { value: "300", label: "5 分钟" },
  { value: "600", label: "10 分钟" },
  { value: "1800", label: "30 分钟" },
  { value: "3600", label: "1 小时" },
  { value: "0", label: "手动刷新" },
]

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 剩余毫秒 → "42s" / "04:32" */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
