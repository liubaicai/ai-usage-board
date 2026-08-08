import { makeCodexAdapter } from "./codex-common"
import type { VendorDef } from "@/lib/types"

/**
 * Codex（OpenAI ChatGPT 订阅）· 统一接入
 * 授权方式（authMethod 下拉选择）：
 *  - auth-json：粘贴 ~/.codex/auth.json 内容（含 tokens.access_token / refresh_token / account_id）
 *  - cookie：粘贴 chatgpt.com 网页 Cookie（含 __Secure-next-auth.session-token），服务端换 access_token
 *  - sub2api：粘贴 sub2api 导出 JSON（accounts[].credentials.access_token / chatgpt_account_id）
 *  - cliproxy：粘贴 cliproxy / CPA 导出 JSON（access_token / account_id）
 *  - oauth：OAuth 设备授权（对话框内完成授权，自动写入凭证）
 * 用量接口：GET chatgpt.com/backend-api/wham/usage（5h / 每周窗口）
 */
export const codex: VendorDef = {
  id: "codex",
  name: "Codex",
  vendor: "OpenAI",
  kind: "subscription",
  authType: "oauth",
  oauthFlow: "codex",
  windowTemplates: [
    { id: "codex-5h", label: "5 小时限额" },
    { id: "codex-weekly", label: "每周限额" },
  ],
  fields: [
    {
      key: "authMethod",
      label: "授权方式",
      required: true,
      options: [
        { value: "auth-json", label: "auth.json" },
        { value: "cookie", label: "网页 Cookie" },
        { value: "sub2api", label: "sub2api 导出" },
        { value: "cliproxy", label: "cliproxy 导出" },
        { value: "oauth", label: "OAuth 设备授权" },
      ],
    },
    {
      key: "content",
      label: "授权内容",
      placeholder:
        "粘贴 auth.json / sub2api / cliproxy / Cookie 内容；OAuth 方式请用下方按钮授权",
      multiline: true,
      secret: true,
      dependsOn: { key: "authMethod", values: ["auth-json", "cookie", "sub2api", "cliproxy"] },
    },
  ],
}

export const adapter = makeCodexAdapter()
