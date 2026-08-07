import { NextResponse } from "next/server"

import { maskAccounts, saveStore } from "@/lib/store"

export const dynamic = "force-dynamic"

/** 拖拽排序：按 body.ids 的顺序重排账号列表 */
export async function POST(req: Request) {
  const { ids } = (await req.json()) as { ids?: string[] }
  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: "缺少 ids" }, { status: 400 })
  }
  const store = await saveStore((s) => {
    const index = new Map(s.accounts.map((a, i) => [a.id, i]))
    const order = ids.filter((id) => index.has(id))
    const rest = s.accounts.filter((a) => !order.includes(a.id))
    s.accounts = order
      .map((id) => s.accounts[index.get(id)!])
      .concat(rest)
  })
  return NextResponse.json(maskAccounts(store.accounts))
}
