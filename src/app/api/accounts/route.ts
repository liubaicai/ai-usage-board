import { NextResponse } from "next/server"

import { createAccountEntity, maskAccount, saveStore } from "@/lib/store"
import { VENDOR_MAP } from "@/vendors"
import type { AccountInput } from "@/lib/types"

export const dynamic = "force-dynamic"

/** 新增账号：id 与初始用量由服务端生成（首次刷新即真实拉取） */
export async function POST(req: Request) {
  const input = (await req.json()) as AccountInput
  const vendor = VENDOR_MAP[input.vendorId]
  if (!vendor) {
    return NextResponse.json({ error: "未知供应商" }, { status: 400 })
  }
  const acc = createAccountEntity(
    vendor,
    input.label ?? "",
    input.config ?? {},
    input.refreshSec ?? null
  )
  if (input.plan?.trim()) acc.plan = input.plan.trim()
  const store = await saveStore((s) => {
    s.accounts.push(acc)
  })
  return NextResponse.json(maskAccount(acc, vendor), { status: 201 })
}
