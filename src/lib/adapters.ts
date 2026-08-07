import { ADAPTERS } from "@/vendors"
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
}

export type Adapter = (config: Record<string, string>) => Promise<FetchResult>

export function hasAdapter(vendorId: string): boolean {
  return vendorId in ADAPTERS
}

/** 拉取真实用量并合并到账号；仅当厂商已注册适配器时使用 */
export async function fetchAccountUsage(
  account: Account,
  vendor: VendorDef
): Promise<Account> {
  const adapter = ADAPTERS[vendor.id]
  if (!adapter) throw new Error(`「${vendor.name}」尚未接入实时查询`)
  const result = await adapter(account.config)
  const now = Date.now()
  return {
    ...account,
    balance: result.balance ?? account.balance,
    windows: result.windows ?? account.windows,
    status: result.status ?? "ok",
    note: result.note ?? account.note,
    lastFetched: now,
    updatedAt: formatTime(now),
  }
}
