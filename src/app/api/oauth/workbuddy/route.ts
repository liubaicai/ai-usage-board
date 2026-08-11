import { NextResponse } from "next/server"
import { httpGetJson, postJson, runWithProxy } from "@/lib/http"

export const dynamic = "force-dynamic"

const API_BASE = "https://www.codebuddy.cn"
const API_PREFIX = "/v2/plugin"

/** POST /api/oauth/workbuddy
 *  - body 无 state：发起 WorkBuddy 授权（POST /v2/plugin/auth/state），返回授权链接
 *  - body 含 state：轮询授权结果（GET /v2/plugin/auth/token?state=xxx），成功返回 access_token / refresh_token
 *  - body 可带 proxy */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      state?: string
      proxy?: string
    }
    const proxy = body.proxy?.trim() || undefined

    return await runWithProxy(proxy, async () => {
      if (body.state) {
        // 轮询授权结果
        const url = `${API_BASE}${API_PREFIX}/auth/token?state=${encodeURIComponent(body.state)}`
        const resp = (await httpGetJson(url, {})) as Record<string, unknown>
        const code = Number(resp.code ?? -1)

        if (code === 0 || code === 200) {
          const data = (resp.data ?? {}) as Record<string, unknown>
          const accessToken =
            typeof data.accessToken === "string"
              ? data.accessToken
              : typeof data.access_token === "string"
                ? data.access_token
                : ""
          if (accessToken) {
            // 授权成功，获取账号信息（uid/email/nickname/enterprise_id）
            // 优先用 GET /v2/plugin/accounts（与 CockpitTools build_payload_from_token 一致），
            // fallback 到 GET /v2/plugin/login/account?state=xxx
            let accountInfo: Record<string, unknown> = {}
            try {
              const accountsResp = (await httpGetJson(
                `${API_BASE}${API_PREFIX}/accounts`,
                { Authorization: `Bearer ${accessToken}` }
              )) as Record<string, unknown>
              const accountsData = (accountsResp.data ?? {}) as Record<string, unknown>
              const accountsList = Array.isArray(accountsData.accounts)
                ? (accountsData.accounts as unknown[])
                : []
              // 取 lastLogin=true 的账号，否则取第一个
              const matched =
                accountsList.find((a) => {
                  const obj = a as Record<string, unknown>
                  return obj.lastLogin === true
                }) ?? accountsList[0]
              accountInfo = (matched ?? {}) as Record<string, unknown>
            } catch {
              // fallback: login/account?state=xxx
              try {
                const accountResp = (await httpGetJson(
                  `${API_BASE}${API_PREFIX}/login/account?state=${encodeURIComponent(body.state)}`,
                  { Authorization: `Bearer ${accessToken}` }
                )) as Record<string, unknown>
                accountInfo = (accountResp.data ?? {}) as Record<string, unknown>
              } catch {
                // 账号信息获取失败不阻断流程
              }
            }

            return NextResponse.json({
              status: "ok",
              accessToken,
              refreshToken:
                typeof data.refreshToken === "string"
                  ? data.refreshToken
                  : typeof data.refresh_token === "string"
                    ? data.refresh_token
                    : undefined,
              uid: typeof accountInfo.uid === "string" ? accountInfo.uid : undefined,
              email: typeof accountInfo.email === "string" ? accountInfo.email : undefined,
              nickname:
                typeof accountInfo.nickname === "string" ? accountInfo.nickname : undefined,
              enterpriseId:
                typeof accountInfo.enterpriseId === "string"
                  ? accountInfo.enterpriseId
                  : undefined,
              enterpriseName:
                typeof accountInfo.enterpriseName === "string"
                  ? accountInfo.enterpriseName
                  : undefined,
              domain: typeof data.domain === "string" ? data.domain : undefined,
            })
          }
        }

        // 还在等待授权（code 非 0/200）
        return NextResponse.json({ status: "pending", interval: 2 })
      }

      // 发起授权：POST /v2/plugin/auth/state
      const url = `${API_BASE}${API_PREFIX}/auth/state?platform=workbuddy`
      const resp = (await postJson(url, {}, {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
      })) as Record<string, unknown>

      const data = (resp.data ?? {}) as Record<string, unknown>
      const state = typeof data.state === "string" ? data.state : ""
      if (!state) {
        throw new Error(`授权发起失败：${JSON.stringify(resp).slice(0, 200)}`)
      }

      const authUrl =
        typeof data.authUrl === "string"
          ? data.authUrl
          : typeof data.auth_url === "string"
            ? data.auth_url
            : typeof data.url === "string"
              ? data.url
              : ""

      const verificationUri = authUrl || `${API_BASE}/login?state=${encodeURIComponent(state)}`

      return NextResponse.json({
        state,
        verification_uri: verificationUri,
        expires_in: 600,
        interval: 2,
      })
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OAuth 请求失败" },
      { status: 500 }
    )
  }
}
