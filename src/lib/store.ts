import { promises as fs } from "node:fs"
import path from "node:path"

import { VENDOR_MAP } from "@/vendors"
import { KEEP_SECRET, type Account, type AppSettings, type VendorDef } from "@/lib/types"

/**
 * 存储层：单一 JSON 文件（data/store.json）承载全部数据：
 * 卡片列表（含顺序）、每卡配置与 API Key、全局设置、最近一次用量快照。
 * 密钥对前端不可见（返回时按厂商字段 mask 为 KEEP_SECRET 哨兵）。
 * 初始为空账号列表（无种子数据），由用户自行新增接入。
 */
export interface Store {
  accounts: Account[]
  settings: AppSettings
}

const DATA_DIR = path.join(process.cwd(), "data")
const FILE = path.join(DATA_DIR, "store.json")

let cache: Store | null = null
let writeQueue: Promise<void> = Promise.resolve()

async function load(): Promise<Store> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(FILE, "utf-8")
    const parsed = JSON.parse(raw) as Store
    if (!Array.isArray(parsed.accounts) || !parsed.settings) throw new Error("bad shape")
    // 清理已下架厂商的孤儿账号（如厂商被移除后遗留的卡片）
    const known = parsed.accounts.filter((a) => VENDOR_MAP[a.vendorId])
    if (known.length !== parsed.accounts.length) {
      parsed.accounts = known
      cache = parsed
      await persist()
    } else {
      cache = parsed
    }
  } catch {
    // 首次运行或文件损坏：空账号列表
    cache = { accounts: [], settings: { globalRefreshSec: 300 } }
    await persist()
  }
  return cache
}

/** 写队列串行化，避免并发写坏文件 */
function persist(): Promise<void> {
  const snapshot = cache!
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(FILE, JSON.stringify(snapshot, null, 2), "utf-8")
  })
  return writeQueue
}

export async function getStore(): Promise<Store> {
  return load()
}

export async function saveStore(mutate: (s: Store) => void): Promise<Store> {
  const s = await load()
  mutate(s)
  await persist()
  return s
}

/** 按厂商字段定义，把密钥类配置替换为哨兵后返回给前端 */
export function maskAccount(acc: Account, vendor?: VendorDef): Account {
  const config: Record<string, string> = {}
  for (const f of vendor?.fields ?? []) {
    const v = acc.config[f.key]
    config[f.key] = f.secret && v ? KEEP_SECRET : (v ?? f.options?.[0]?.value ?? "")
  }
  // 保留非厂商封装的通用字段（proxy 等非密钥类额外配置，不需 mask）
  if (acc.config.proxy) config.proxy = acc.config.proxy
  return { ...acc, config }
}

/** 更新时解析配置：密钥留空/哨兵 → 保留旧值；非密钥字段直接覆盖 */
export function resolveConfig(
  existing: Record<string, string>,
  incoming: Record<string, string>,
  vendor: VendorDef
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of vendor.fields) {
    const v = incoming[f.key] ?? ""
    if (f.secret) {
      if (v === "" || v === KEEP_SECRET) {
        out[f.key] = existing[f.key] ?? ""
      } else {
        out[f.key] = v
      }
    } else {
      out[f.key] = v
    }
  }
  // 保留非厂商封装的通用字段（proxy 等，不参与 mask/sentinel 逻辑）
  out.proxy = incoming.proxy ?? existing.proxy ?? ""
  return out
}

export function maskAccounts(accounts: Account[]): Account[] {
  return accounts.map((a) => maskAccount(a, VENDOR_MAP[a.vendorId]))
}

/** 新建账号实体：不含用量数据（lastFetched=0，首次刷新立即真实拉取） */
export function createAccountEntity(
  vendor: VendorDef,
  label: string,
  config: Record<string, string>,
  refreshSec: number | null
): Account {
  return {
    id: crypto.randomUUID(),
    vendorId: vendor.id,
    label: label.trim() || vendor.name,
    plan: vendor.defaultPlan,
    config,
    refreshSec,
    status: "ok",
    lastFetched: 0,
    updatedAt: "",
  }
}
