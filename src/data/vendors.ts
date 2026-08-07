import type { VendorDef } from "@/lib/types"

/** 厂商目录：声明每种供应商的接入方式与配置字段，表单据此动态渲染 */
export const VENDORS: VendorDef[] = [
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    kind: "subscription",
    authType: "json",
    defaultPlan: "ChatGPT Plus",
    windowTemplates: [
      { id: "5h", label: "5 小时限额" },
      { id: "week", label: "每周限额" },
    ],
    fields: [
      {
        key: "authJson",
        label: "auth.json 内容",
        placeholder: "粘贴 ~/.codex/auth.json 的内容",
        multiline: true,
        required: true,
      },
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    kind: "subscription",
    authType: "oauth",
    defaultPlan: "Pro",
    windowTemplates: [
      { id: "5h", label: "5 小时限额" },
      { id: "week", label: "每周限额" },
      { id: "opus", label: "Opus 周限额" },
    ],
    fields: [
      {
        key: "sessionKey",
        label: "Session Key",
        placeholder: "sk-ant-... 或网页会话凭证",
        secret: true,
        required: true,
      },
    ],
  },
  {
    id: "glm",
    name: "GLM Coding Plan",
    vendor: "智谱 AI",
    kind: "subscription",
    authType: "apikey",
    defaultPlan: "Pro 季卡",
    windowTemplates: [
      { id: "5h", label: "5 小时限额" },
      { id: "week", label: "每周限额" },
    ],
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "xxxxxxxx.xxxxxxxx",
        secret: true,
        required: true,
      },
    ],
  },
  {
    id: "kimi",
    name: "Kimi For Coding",
    vendor: "Moonshot AI",
    kind: "subscription",
    authType: "cookie",
    defaultPlan: "月度订阅",
    windowTemplates: [
      { id: "5h", label: "5 小时限额" },
      { id: "week", label: "每周限额" },
    ],
    fields: [
      {
        key: "cookie",
        label: "网页 Cookie",
        placeholder: "从 kimi.com 开发者工具中复制 Cookie 头",
        multiline: true,
        required: true,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    vendor: "深度求索",
    kind: "payg",
    authType: "apikey",
    currency: "CNY",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    vendor: "OpenRouter",
    kind: "payg",
    authType: "apikey",
    currency: "USD",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-or-...", secret: true, required: true },
    ],
  },
  {
    id: "bailian",
    name: "阿里云百炼",
    vendor: "Alibaba Cloud",
    kind: "payg",
    authType: "key+org",
    currency: "CNY",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
      { key: "orgId", label: "Org ID / Workspace", placeholder: "组织或工作空间 ID", required: true },
    ],
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    vendor: "硅基流动",
    kind: "payg",
    authType: "apikey",
    currency: "CNY",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
    ],
  },
  {
    id: "moonshot-api",
    name: "Moonshot 开放平台",
    vendor: "Moonshot AI",
    kind: "payg",
    authType: "apikey",
    currency: "CNY",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
    ],
  },
]

export const VENDOR_MAP: Record<string, VendorDef> = Object.fromEntries(
  VENDORS.map((v) => [v.id, v])
)
