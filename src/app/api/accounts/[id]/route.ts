import { NextResponse } from "next/server"

import { maskAccount, resolveConfig, saveStore } from "@/lib/store"
import { VENDOR_MAP } from "@/vendors"
import type { AccountInput } from "@/lib/types"

export const dynamic = "force-dynamic"

type Params = { params: { id: string } }

/** 更新账号：密钥留空/哨兵保持旧值，用量字段保留 */
export async function PUT(req: Request, { params }: Params) {
  const id = params.id
  const input = (await req.json()) as AccountInput
  const store = await saveStore((s) => {
    const idx = s.accounts.findIndex((a) => a.id === id)
    if (idx < 0) return
    const existing = s.accounts[idx]
    const vendor = VENDOR_MAP[existing.vendorId] ?? VENDOR_MAP[input.vendorId]
    if (!vendor) return
    const config = resolveConfig(existing.config, input.config ?? {}, vendor)
    s.accounts[idx] = {
      ...existing,
      vendorId: vendor.id,
      label: input.label?.trim() || existing.label,
      plan: input.plan?.trim() || existing.plan,
      config,
      refreshSec: input.refreshSec ?? existing.refreshSec,
    }
  })
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) return NextResponse.json({ error: "账号不存在" }, { status: 404 })
  return NextResponse.json(maskAccount(acc, VENDOR_MAP[acc.vendorId]))
}

/** 删除账号 */
export async function DELETE(_req: Request, { params }: Params) {
  const id = params.id
  const store = await saveStore((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== id)
  })
  const exists = store.accounts.some((a) => a.id === id)
  if (!exists) return NextResponse.json({ ok: true })
  return NextResponse.json({ ok: true })
}
