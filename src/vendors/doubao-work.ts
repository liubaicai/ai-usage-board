import { postJson } from "@/lib/http"
import { statusFromWindows, type QuotaWindow, type VendorDef } from "@/lib/types"
import type { Adapter, FetchResult } from "@/lib/adapters"

/**
 * 豆包工作（字节跳动）· 订阅制
 * 接入方式：粘贴 www.doubao.com 网页登录后的 Cookie（必须包含 sessionid）
 *   浏览器 DevTools → Application → Cookies → https://www.doubao.com → 复制整段
 *   仅 sessionid + sessionid_ss 通常已足够；粘贴完整 Cookie 更稳妥。
 *
 * 接口（与前端「额度状态」面板同源，实测服务端直连可用，无需 a_bogus 反爬签名）：
 *   POST https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/
 *   Headers: Cookie + Origin/Referer: https://www.doubao.com/（浏览器 UA）
 *   Body: { product_line: "membership" }
 *   Query 参数可省略（version_code / aid 等仅用于对齐官方客户端，非必需）
 *
 * 响应（window_limit_section.window_limit_groups[].window_limits[]）：
 *   window_type = 1 → 当前时段（官方口径：5 小时滚动活跃窗口；未开始计时时 start/end 均为 0）
 *   window_type = 2 → 近 7 天总额度（end_time 为重置时间）
 *   used_percent 为整数百分比；低于 1% 时 used_percent = 0 且 less_than_one_percent = true
 *   套餐名取 current_subscription.display.short_name（如「标准套餐」），
 *   end_time 为订阅到期时间（赠送时长场景下即赠送到期日）。
 * 说明：接口只提供百分比，不返回绝对额度数值（标准档官方口径为 7 天 2100 额度）。
 * 团队/企业订阅的窗口位于 enterprise_window_limit_section，个人窗口为空时自动回退取用。
 */
export const doubaoWork: VendorDef = {
  id: "doubao-work",
  name: "豆包工作",
  vendor: "字节跳动",
  kind: "subscription",
  authType: "cookie",
  windowTemplates: [
    { id: "doubao-5h", label: "当前时段" },
    { id: "doubao-7d", label: "近 7 天" },
  ],
  fields: [
    {
      key: "content",
      label: "网页 Cookie",
      placeholder:
        "粘贴 www.doubao.com 登录后的 Cookie（需含 sessionid；DevTools → Application → Cookies 复制整段）",
      multiline: true,
      secret: true,
      required: true,
    },
  ],
}

const SUMMARY_URL =
  "https://www.doubao.com/alice/commerce/sale/subscription/quota/summary/" +
  "?version_code=20800&language=zh&device_platform=web&doubao_device_platform=web&aid=497858&real_aid=497858"

/** 浏览器请求头（与官网前端一致，降低风控概率） */
const BROWSER_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  Origin: "https://www.doubao.com",
  Referer: "https://www.doubao.com/chat/",
}

interface WindowLimit {
  window_type?: number
  used_percent?: number
  less_than_one_percent?: boolean
  start_time?: number
  end_time?: number
}

interface WindowLimitSection {
  entitlement_count?: number
  usage_exhausted?: boolean
  window_limit_groups?: { feature_group?: string; window_limits?: WindowLimit[] }[]
}

interface QuotaSummary {
  code?: number
  msg?: string
  data?: {
    current_subscription?: {
      end_time?: number
      is_gift?: boolean
      display?: { product_name?: string; short_name?: string }
    }
    member_info?: { hasActiveSubscription?: boolean; hasEnterpriseSubscription?: boolean }
    window_limit_section?: WindowLimitSection
    enterprise_window_limit_section?: WindowLimitSection
  }
}

/** 剩余毫秒 → "3h 20m" / "12m"（与其它厂商卡片口径一致） */
function formatResetMs(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined
  if (ms <= 0) return "即将重置"
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

/** 毫秒时间戳 → "2026-09-18" */
function formatDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Cookie 文本规范化：去除 "Cookie:" 前缀，换行/分号统一为 "; " 分隔 */
function normalizeCookie(raw: string): string {
  return raw
    .replace(/^\s*cookie\s*:\s*/i, "")
    .split(/[\n;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ")
}

/** 取窗口集合：个人订阅优先，为空时回退企业/团队订阅 */
function pickSection(data: QuotaSummary["data"]): WindowLimitSection | undefined {
  const personal = data?.window_limit_section
  if (personal?.window_limit_groups?.some((g) => g.window_limits?.length)) return personal
  const enterprise = data?.enterprise_window_limit_section
  if (enterprise?.window_limit_groups?.some((g) => g.window_limits?.length)) return enterprise
  return personal ?? enterprise
}

export const adapter: Adapter = async (config) => {
  const cookieHeader = normalizeCookie((config.content ?? "").trim())
  if (!cookieHeader) throw new Error("缺少网页 Cookie，请在编辑中粘贴")
  if (!/sessionid=/.test(cookieHeader)) {
    throw new Error("Cookie 中缺少 sessionid，请复制完整 Cookie（须含 sessionid）")
  }

  const payload = (await postJson(
    SUMMARY_URL,
    { product_line: "membership" },
    { ...BROWSER_HEADERS, Cookie: cookieHeader }
  ).catch((e) => {
    throw new Error(
      `额度接口请求失败（Cookie 可能失效，请重新登录 www.doubao.com 复制）：${
        e instanceof Error ? e.message : String(e)
      }`
    )
  })) as QuotaSummary

  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`额度接口返回错误：code=${payload.code}${payload.msg ? ` ${payload.msg}` : ""}`)
  }

  const section = pickSection(payload.data)
  const limits = (section?.window_limit_groups ?? []).flatMap((g) => g.window_limits ?? [])
  if (!limits.length) {
    throw new Error(
      payload.data?.member_info?.hasActiveSubscription === false
        ? "该账号没有生效中的豆包订阅（额度状态面板无窗口数据）"
        : `响应缺少额度窗口：${JSON.stringify(payload).slice(0, 150)}`
    )
  }

  const exhausted = section?.usage_exhausted === true
  const windows: QuotaWindow[] = []
  const pushWindow = (
    id: string,
    label: string,
    windowType: number,
    { withReset }: { withReset: boolean }
  ) => {
    const limit = limits.find((l) => l.window_type === windowType)
    if (!limit) return
    const used = Math.round(Number(limit.used_percent) || 0)
    windows.push({
      id,
      label,
      // 接口已判定额度耗尽时以 100% 呈现，避免 used_percent 滞后导致漏报
      usedPercent: exhausted ? 100 : Math.min(100, Math.max(0, used)),
      resetIn:
        withReset && (limit.end_time ?? 0) > 0 ? formatResetMs((limit.end_time as number) - Date.now()) : undefined,
    })
  }
  // window_type 1 = 当前时段（5 小时滚动窗口，未开始计时时无重置时间）
  pushWindow("doubao-5h", "当前时段", 1, { withReset: false })
  pushWindow("doubao-7d", "近 7 天", 2, { withReset: true })

  if (!windows.length) {
    throw new Error(`响应缺少已识别的额度窗口：${JSON.stringify(payload).slice(0, 150)}`)
  }

  const sub = payload.data?.current_subscription
  const endTime = Number(sub?.end_time) || 0
  return {
    windows,
    plan: sub?.display?.short_name || sub?.display?.product_name,
    subscriptionExpiresAt: endTime > 0 ? formatDate(endTime) : undefined,
    status: statusFromWindows(windows),
    note: sub?.is_gift ? "豆包工作订阅额度（赠送时长）" : "豆包工作订阅额度",
  } satisfies FetchResult
}
