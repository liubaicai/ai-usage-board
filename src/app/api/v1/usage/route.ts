import { NextResponse } from "next/server"

import { buildPublicUsageResponse } from "@/lib/public-api"
import { requirePublicApiAuth } from "@/lib/public-api-auth"
import { getStore } from "@/lib/store"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Stable, read-only usage snapshot for CLI/TUI and third-party integrations. */
export async function GET(req: Request) {
  const unauthorized = requirePublicApiAuth(req)
  if (unauthorized) return unauthorized

  const store = await getStore()
  return NextResponse.json(
    buildPublicUsageResponse(store.accounts, store.settings),
    { headers: { "Cache-Control": "no-store" } }
  )
}
