import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

function tokensEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest)
}

/**
 * Public API authentication is opt-in for backwards-compatible local use.
 * Set AI_USAGE_BOARD_API_TOKEN to require a Bearer token or X-API-Key.
 */
export function requirePublicApiAuth(req: Request): NextResponse | null {
  const expected = process.env.AI_USAGE_BOARD_API_TOKEN?.trim()
  if (!expected) return null

  const authorization = req.headers.get("authorization")?.trim() ?? ""
  const separator = authorization.indexOf(" ")
  const scheme = separator >= 0 ? authorization.slice(0, separator) : ""
  const bearer = scheme.toLowerCase() === "bearer"
    ? authorization.slice(separator + 1).trim()
    : ""
  const apiKey = req.headers.get("x-api-key")?.trim() ?? ""
  if (
    (bearer && tokensEqual(bearer, expected)) ||
    (apiKey && tokensEqual(apiKey, expected))
  ) {
    return null
  }

  return NextResponse.json(
    { error: "未授权：请提供有效的 Bearer Token 或 X-API-Key" },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    }
  )
}
