import type { Account, AppSettings, ProviderKind, ProviderStatus } from "@/lib/types"
import { VENDOR_MAP } from "@/vendors"

export interface PublicUsageWindow {
  id: string
  label: string
  usedPercent: number
  /** false 表示厂商定义了该窗口，但当前账号未返回对应配额数据 */
  available: boolean
  resetIn?: string
  detail?: string
  value?: string
  group?: string
}

export interface PublicBalance {
  amount: number
  currency: "CNY" | "USD"
  granted?: number
  totalBalance?: number
}

export interface PublicUsageAccount {
  id: string
  vendorId: string
  vendorName: string
  vendor: string
  kind: ProviderKind
  label: string
  accountName?: string
  plan?: string
  subscriptionExpiresAt?: string
  status: ProviderStatus
  windows: PublicUsageWindow[]
  balance?: PublicBalance
  note?: string
  refreshSec: number | null
  lastFetched: number
  updatedAt: string
}

export interface PublicUsageResponse {
  apiVersion: "v1"
  generatedAt: string
  settings: AppSettings
  summary: {
    total: number
    ok: number
    warn: number
    error: number
    balanceByCurrency: {
      CNY: number
      USD: number
    }
  }
  accounts: PublicUsageAccount[]
}

export function buildPublicUsageResponse(
  accounts: Account[],
  settings: AppSettings
): PublicUsageResponse {
  const publicAccounts = accounts.map<PublicUsageAccount>((account) => {
    const vendor = VENDOR_MAP[account.vendorId]
    const actualWindows = account.windows ?? []
    const matchedWindowIds = new Set<string>()
    const windows: PublicUsageWindow[] = (vendor?.windowTemplates ?? []).map((template) => {
      const actual = actualWindows.find(
        (window) => window.id === template.id || window.label === template.label
      )
      if (actual) {
        matchedWindowIds.add(actual.id)
        return { ...actual, available: true }
      }
      return {
        id: template.id,
        label: template.label,
        usedPercent: 0,
        available: false,
      }
    })
    windows.push(
      ...actualWindows
        .filter((window) => !matchedWindowIds.has(window.id))
        .map((window) => ({ ...window, available: true }))
    )
    return {
      id: account.id,
      vendorId: account.vendorId,
      vendorName: vendor?.name ?? account.vendorId,
      vendor: vendor?.vendor ?? account.vendorId,
      kind: vendor?.kind ?? (account.balance ? "payg" : "subscription"),
      label: account.label,
      accountName: account.accountName,
      plan: account.plan,
      subscriptionExpiresAt: account.subscriptionExpiresAt,
      status: account.status,
      windows,
      balance: account.balance,
      note: account.note,
      refreshSec: account.refreshSec,
      lastFetched: account.lastFetched,
      updatedAt: account.updatedAt,
    }
  })

  const balanceByCurrency = publicAccounts.reduce(
    (sum, account) => {
      if (account.balance) sum[account.balance.currency] += account.balance.amount
      return sum
    },
    { CNY: 0, USD: 0 }
  )

  return {
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    settings,
    summary: {
      total: publicAccounts.length,
      ok: publicAccounts.filter((account) => account.status === "ok").length,
      warn: publicAccounts.filter((account) => account.status === "warn").length,
      error: publicAccounts.filter((account) => account.status === "error").length,
      balanceByCurrency,
    },
    accounts: publicAccounts,
  }
}
