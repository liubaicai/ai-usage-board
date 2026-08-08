import { ADAPTERS } from "@/vendors"
import { runWithProxy } from "@/lib/http"
import type {
  Account,
  Balance,
  ProviderStatus,
  QuotaWindow,
  VendorDef,
} from "@/lib/types"
import { formatTime } from "@/lib/types"

/**
 * 厂商适配器（服务端运行）：真实厂商 API 请求全部从这里发起，
 * 具体实现按厂商拆分在 src/vendors/<vendor>.ts 中，此处只做注册与调用。
 */
export interface FetchResult {
  balance?: Balance
  windows?: QuotaWindow[]
  status?: ProviderStatus
  note?: string
  /** 套餐等级（如 Coding Plan 的 lite/pro/max） */
  plan?: string
  /** 账号真实名称（如 Codex 授权解析出的邮箱 / 用户名），用于卡片区分多账号 */
  accountName?: string
  /** 订阅到期时间（格式化字符串，如 2026-09-08） */
  subscriptionExpiresAt?: string
  /**
   * 可选：本次请求后需要写回账号配置的字段（如 token 自动刷新后的新授权内容）。
   * 由调用方（usage.ts）合并进 store 的 account.config。
   */
  configUpdate?: Record<string, string>
}

export type Adapter = (config: Record<string, string>) => Promise<FetchResult>

export function hasAdapter(vendorId: string): boolean {
  return vendorId in ADAPTERS
}

/** 拉取真实用量并合并到账号；仅当厂商已注册适配器时使用。
 *  账号配置了 proxy 时，该账号的全部厂商请求自动走代理（AsyncLocalStorage 上下文注入）。 */
export async function fetchAccountUsage(
  account: Account,
  vendor: VendorDef
): Promise<{ account: Account; configUpdate?: Record<string, string> }> {
  const adapter = ADAPTERS[vendor.id]
  if (!adapter) throw new Error(`「${vendor.name}」尚未接入实时查询`)
  return runWithProxy(account.config.proxy?.trim() || undefined, async () => {
    const result = await adapter(account.config)
    const now = Date.now()
    const next: Account = {
      ...account,
      plan: result.plan ?? account.plan,
      accountName: result.accountName ?? account.accountName,
      subscriptionExpiresAt:
        result.subscriptionExpiresAt ?? account.subscriptionExpiresAt,
      balance: result.balance ?? account.balance,
      windows: result.windows ?? account.windows,
      status: result.status ?? "ok",
      note: result.note ?? account.note,
      lastFetched: now,
      updatedAt: formatTime(now),
    }
    return { account: next, configUpdate: result.configUpdate }
  })
}
