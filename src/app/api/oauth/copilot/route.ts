import { NextResponse } from "next/server"
import { postForm, runWithProxy } from "@/lib/http"

export const dynamic = "force-dynamic"

/** GitHub OAuth 设备授权（VSCode Copilot 的 client_id） */
const GH_CLIENT_ID = "Iv1.b507a08c87ecfe98"

/** POST /api/oauth/copilot
 *  - body 无 deviceCode：发起 GitHub 设备授权
 *  - body 含 deviceCode：轮询授权结果，成功返回 GitHub OAuth token（ghu_xxx）
 *  - body 可带 proxy */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      deviceCode?: string
      proxy?: string
    }
    const proxy = body.proxy?.trim() || undefined

    return await runWithProxy(proxy, async () => {
      if (body.deviceCode) {
        const r = await postForm(
          "https://github.com/login/oauth/access_token",
          new URLSearchParams({
            client_id: GH_CLIENT_ID,
            device_code: body.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          { Accept: "application/json" }
        )
        if (r.data.access_token) {
          return NextResponse.json({ status: "ok", githubToken: r.data.access_token })
        }
        const err = String(r.data.error ?? "")
        if (err === "authorization_pending" || err === "slow_down") {
          return NextResponse.json({ status: "pending" })
        }
        return NextResponse.json({ status: "expired", error: err || "未知错误" })
      }

      // 发起设备授权
      const r = await postForm(
        "https://github.com/login/device/code",
        new URLSearchParams({
          client_id: GH_CLIENT_ID,
          scope: "read:user",
        }),
        { Accept: "application/json" }
      )
      if (!r.data.device_code || !r.data.user_code) {
        if (typeof r.data.raw === "string" && r.data.raw.startsWith("<")) {
          throw new Error(
            "github.com 返回非 JSON（可能被拦截，当前网络无法直连 GitHub）。请更换网络/代理后重试，或改用 Fine-grained PAT 授权方式"
          )
        }
        throw new Error(`设备授权失败：${JSON.stringify(r.data).slice(0, 200)}`)
      }
      return NextResponse.json({
        device_code: r.data.device_code,
        user_code: r.data.user_code,
        verification_uri: r.data.verification_uri ?? "https://github.com/login/device",
        expires_in: Number(r.data.expires_in) || 900,
        interval: Number(r.data.interval) || 5,
      })
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OAuth 请求失败" },
      { status: 500 }
    )
  }
}
