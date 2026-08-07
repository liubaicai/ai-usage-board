import { fetchAccountUsage, hasAdapter } from "@/lib/adapters"
import { getStore, saveStore } from "@/lib/store"
import { VENDOR_MAP } from "@/vendors"
import { formatTime, type Account } from "@/lib/types"

/** 服务端并发去重：同一账号同时只发一次真实拉取 */
const inflight = new Map<string, Promise<Account>>()

export async function refreshAccount(id: string): Promise<Account> {
  const running = inflight.get(id)
  if (running) return running
  const p = doRefresh(id).finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

async function doRefresh(id: string): Promise<Account> {
  const store = await getStore()
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error("账号不存在")
  const vendor = VENDOR_MAP[acc.vendorId]
  if (!vendor) throw new Error("厂商未注册")
  if (!hasAdapter(vendor.id)) {
    throw new Error(`「${vendor.name}」尚未接入实时查询`)
  }

  const nowTs = Date.now()
  let updated: Account
  let configUpdate: Record<string, string> | undefined
  try {
    // 真实厂商接口，全部在服务端发起（本项目的厂商目录只保留已接入的厂商）
    const res = await fetchAccountUsage(acc, vendor)
    updated = res.account
    configUpdate = res.configUpdate
  } catch (e) {
    updated = {
      ...acc,
      status: "error",
      note: `拉取失败：${e instanceof Error ? e.message : "未知错误"}`,
      lastFetched: nowTs,
      updatedAt: formatTime(nowTs),
    }
  }

  await saveStore((s) => {
    s.accounts = s.accounts.map((a) => {
      if (a.id !== id) return a
      // token 自动刷新后写回新授权内容（如新的 auth.json）
      if (configUpdate) {
        updated = { ...updated, config: { ...a.config, ...configUpdate } }
      }
      return updated
    })
  })
  return updated
}

export async function refreshAllAccounts(): Promise<Account[]> {
  const store = await getStore()
  return Promise.all(store.accounts.map((a) => refreshAccount(a.id)))
}
