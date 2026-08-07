import { NextResponse } from "next/server"

import { getStore, saveStore } from "@/lib/store"

export const dynamic = "force-dynamic"

/** 读取 / 更新全局刷新间隔 */
export async function GET() {
  const store = await getStore()
  return NextResponse.json(store.settings)
}

export async function PUT(req: Request) {
  const body = (await req.json()) as { globalRefreshSec?: number }
  const sec = Math.min(
    86400,
    Math.max(0, Math.round(Number(body.globalRefreshSec) || 0))
  )
  const store = await saveStore((s) => {
    s.settings.globalRefreshSec = sec
  })
  return NextResponse.json(store.settings)
}
