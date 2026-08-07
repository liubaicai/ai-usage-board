import { NextResponse } from "next/server"

import { maskAccounts, getStore } from "@/lib/store"

export const dynamic = "force-dynamic"

/** 一次性拉取全量状态：账号列表（密钥已 mask）+ 全局设置 */
export async function GET() {
  const store = await getStore()
  return NextResponse.json({
    accounts: maskAccounts(store.accounts),
    settings: store.settings,
  })
}
