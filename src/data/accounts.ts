import type { Account } from "@/lib/types"
import { formatTime } from "@/lib/types"

/** 首次启动的演示账号（含同厂商多账号示例） */
export function seedAccounts(): Account[] {
  const now = Date.now()
  const t = formatTime(now)
  const mk = (partial: Omit<Account, "id" | "lastFetched" | "updatedAt">): Account => ({
    id: crypto.randomUUID(),
    lastFetched: now,
    updatedAt: t,
    ...partial,
  })
  return [
    mk({
      vendorId: "codex",
      label: "主账号",
      plan: "ChatGPT Plus",
      config: { authJson: "{...}" },
      refreshSec: null,
      status: "ok",
      windows: [
        { id: "5h", label: "5 小时限额", usedPercent: 62, resetIn: "2h 14m", detail: "约 3.1k req" },
        { id: "week", label: "每周限额", usedPercent: 41, resetIn: "4d 06h" },
      ],
    }),
    mk({
      vendorId: "codex",
      label: "团队号",
      plan: "ChatGPT Business",
      config: { authJson: "{...}" },
      refreshSec: 60,
      status: "ok",
      windows: [
        { id: "5h", label: "5 小时限额", usedPercent: 8, resetIn: "4h 40m" },
        { id: "week", label: "每周限额", usedPercent: 15, resetIn: "5d 01h" },
      ],
    }),
    mk({
      vendorId: "claude-code",
      label: "Claude Code",
      plan: "Pro",
      config: { sessionKey: "sk-ant-..." },
      refreshSec: null,
      status: "warn",
      windows: [
        { id: "5h", label: "5 小时限额", usedPercent: 87, resetIn: "1h 02m", detail: "接近上限" },
        { id: "week", label: "每周限额", usedPercent: 55, resetIn: "3d 11h" },
        { id: "opus", label: "Opus 周限额", usedPercent: 23, resetIn: "3d 11h" },
      ],
    }),
    mk({
      vendorId: "glm",
      label: "GLM Coding Plan",
      plan: "Pro 季卡",
      config: { apiKey: "..." },
      refreshSec: null,
      status: "ok",
      windows: [
        { id: "5h", label: "5 小时限额", usedPercent: 18, resetIn: "4h 51m", detail: "GLM-4.6" },
        { id: "week", label: "每周限额", usedPercent: 34, resetIn: "5d 02h" },
      ],
    }),
    mk({
      vendorId: "kimi",
      label: "Kimi For Coding",
      plan: "月度订阅",
      config: { cookie: "..." },
      refreshSec: null,
      status: "ok",
      windows: [
        { id: "5h", label: "5 小时限额", usedPercent: 45, resetIn: "3h 08m" },
        { id: "week", label: "每周限额", usedPercent: 12, resetIn: "6d 09h" },
      ],
    }),
    mk({
      vendorId: "deepseek",
      label: "DeepSeek",
      config: { apiKey: "sk-..." },
      refreshSec: null,
      status: "ok",
      balance: { amount: 128.4, currency: "CNY", granted: 10.0, totalBalance: 138.4 },
      note: "deepseek-chat / reasoner",
    }),
    mk({
      vendorId: "openrouter",
      label: "OpenRouter",
      config: { apiKey: "sk-or-..." },
      refreshSec: null,
      status: "ok",
      balance: { amount: 42.17, currency: "USD" },
      note: "聚合 300+ 模型",
    }),
    mk({
      vendorId: "bailian",
      label: "阿里云百炼",
      config: { apiKey: "sk-...", orgId: "org-..." },
      refreshSec: null,
      status: "ok",
      balance: { amount: 356.02, currency: "CNY" },
      note: "qwen3-coder-plus",
    }),
    mk({
      vendorId: "siliconflow",
      label: "SiliconFlow",
      config: { apiKey: "sk-..." },
      refreshSec: null,
      status: "error",
      balance: { amount: 9.86, currency: "CNY", granted: 14.0, totalBalance: 23.86 },
      note: "余额不足，请充值",
    }),
    mk({
      vendorId: "moonshot-api",
      label: "Moonshot 开放平台",
      config: { apiKey: "sk-..." },
      refreshSec: null,
      status: "ok",
      balance: { amount: 76.5, currency: "CNY" },
    }),
  ]
}
