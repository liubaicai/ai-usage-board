import { NextResponse } from "next/server"

import { refreshAllAccounts } from "@/lib/usage"
import { maskAccounts } from "@/lib/store"

export const dynamic = "force-dynamic"

/** 立即刷新全部账号，返回全部账号（含最新用量、mask 配置） */
export async function POST() {
  const accounts = await refreshAllAccounts()
  return NextResponse.json(maskAccounts(accounts))
}
