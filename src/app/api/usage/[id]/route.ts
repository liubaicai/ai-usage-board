import { NextResponse } from "next/server"

import { refreshAccount } from "@/lib/usage"
import { maskAccount, getStore } from "@/lib/store"
import { VENDOR_MAP } from "@/vendors"

export const dynamic = "force-dynamic"

type Params = { params: { id: string } }

/** 刷新单个账号的用量（服务端发起厂商请求），返回含用量与 mask 配置的账号 */
export async function GET(_req: Request, { params }: Params) {
  const id = params.id
  const store = await getStore()
  if (!store.accounts.some((a) => a.id === id)) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 })
  }
  try {
    const updated = await refreshAccount(id)
    return NextResponse.json(maskAccount(updated, VENDOR_MAP[updated.vendorId]))
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "刷新失败" },
      { status: 500 }
    )
  }
}
