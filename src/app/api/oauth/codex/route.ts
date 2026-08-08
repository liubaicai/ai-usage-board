import { NextResponse } from "next/server"
import { postForm, runWithProxy } from "@/lib/http"

export const dynamic = "force-dynamic"

/** OpenAI OAuth 设备授权（client_id 与 Codex CLI 一致） */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

/** POST /api/oauth/codex
 *  - body 无 deviceCode：发起设备授权，返回 device_code / user_code / verification_uri
 *  - body 含 deviceCode：轮询授权结果
 *  - body 可带 proxy：授权请求走该代理（新建账号场景，先填代理再授权） */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      deviceCode?: string
      proxy?: string
    }
    const proxy = body.proxy?.trim() || undefined

    return await runWithProxy(proxy, async () => {
      // 轮询授权结果
      if (body.deviceCode) {
        const r = await postForm("https://auth.openai.com/oauth/device/token", new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: body.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }), {
          "User-Agent": "CodexBar",
          Accept: "application/json",
        })
        if (r.data.access_token) {
          return NextResponse.json({
            status: "ok",
            tokens: {
              access_token: r.data.access_token,
              refresh_token: r.data.refresh_token,
              id_token: r.data.id_token,
              account_id: r.data.account_id,
            },
          })
        }
        const err = String(r.data.error ?? "")
        if (err === "authorization_pending" || err === "slow_down") {
          return NextResponse.json({ status: "pending" })
        }
        return NextResponse.json({ status: "expired", error: err || "未知错误" })
      }

      // 发起设备授权
      const r = await postForm("https://auth.openai.com/oauth/device/code", new URLSearchParams({
        client_id: CLIENT_ID,
        scope: "openid profile email offline_access model.request",
      }), {
        "User-Agent": "CodexBar",
        Accept: "application/json",
      })
      if (!r.data.device_code || !r.data.user_code) {
        if (typeof r.data.raw === "string" && r.data.raw.startsWith("<")) {
          throw new Error(
            "auth.openai.com 返回非 JSON（可能被 Cloudflare 拦截，当前网络无法直连 OpenAI）。请更换网络/代理后重试，或改用 auth.json / sub2api / cliproxy 授权方式"
          )
        }
        throw new Error(`设备授权失败：${JSON.stringify(r.data).slice(0, 200)}`)
      }
      return NextResponse.json({
        device_code: r.data.device_code,
        user_code: r.data.user_code,
        verification_uri: r.data.verification_uri ?? "https://auth.openai.com",
        expires_in: Number(r.data.expires_in) || 600,
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
