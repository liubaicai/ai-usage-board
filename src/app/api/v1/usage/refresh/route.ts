import { NextResponse } from "next/server"

import { buildPublicUsageResponse } from "@/lib/public-api"
import { requirePublicApiAuth } from "@/lib/public-api-auth"
import { getStore } from "@/lib/store"
import { refreshAllAccounts } from "@/lib/usage"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Refresh every provider on the server, then return a stable public snapshot. */
export async function POST(req: Request) {
  const unauthorized = requirePublicApiAuth(req)
  if (unauthorized) return unauthorized

  const accounts = await refreshAllAccounts()
  const store = await getStore()
  return NextResponse.json(
    buildPublicUsageResponse(accounts, store.settings),
    { headers: { "Cache-Control": "no-store" } }
  )
}
