import { NextResponse } from "next/server"

import { buildPublicUsageResponse } from "@/lib/public-api"
import { requirePublicApiAuth } from "@/lib/public-api-auth"
import { getStore } from "@/lib/store"
import { refreshAccount } from "@/lib/usage"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Params = { params: { id: string } }

/** 在服务端刷新单个账号的用量（厂商请求由服务端发起），返回全量公共快照 */
export async function POST(req: Request, { params }: Params) {
  const unauthorized = requirePublicApiAuth(req)
  if (unauthorized) return unauthorized

  const id = params.id
  const store = await getStore()
  if (!store.accounts.some((a) => a.id === id)) {
    return NextResponse.json({ error: "账号不存在" }, { status: 404 })
  }

  await refreshAccount(id)
  // refreshAccount 已持久化最新状态，重新读取后返回稳定快照
  const latest = await getStore()
  return NextResponse.json(
    buildPublicUsageResponse(latest.accounts, latest.settings),
    { headers: { "Cache-Control": "no-store" } }
  )
}
