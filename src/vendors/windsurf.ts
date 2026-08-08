import { postJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Windsurf（Codeium）· 订阅制（credits 制）
 * 接入方式：API Key（sk-ws-01-...，来自 Windsurf 登录后 SQLite 的 windsurfAuthStatus）
 * 接口（cloud fallback）：POST server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus
 *   body: { metadata: { apiKey, ideName: "windsurf", ideVersion: "0.0.0", extensionName: "windsurf", extensionVersion: "0.0.0", locale: "en" } }
 *   Headers: Connect-Protocol-Version: 1
 * 响应：userStatus.planStatus（planName / availablePromptCredits / usedPromptCredits / flex credits，单位百分之一）
 */
export const windsurf: VendorDef = {
  id: "windsurf",
  name: "Windsurf",
  vendor: "Codeium",
  kind: "subscription",
  authType: "apikey",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "sk-ws-01-...（Windsurf 登录后的 API Key）",
      secret: true,
      required: true,
    },
  ],
}

const RPC = "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus"

function pct(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)))
}

export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const data = (await postJson(
    RPC,
    {
      metadata: {
        apiKey: key,
        ideName: "windsurf",
        ideVersion: "0.0.0",
        extensionName: "windsurf",
        extensionVersion: "0.0.0",
        locale: "en",
      },
    },
    { "Connect-Protocol-Version": "1" }
  )) as {
    userStatus?: {
      planStatus?: {
        planInfo?: { planName?: string; monthlyPromptCredits?: number }
        planStart?: string
        planEnd?: string
        availablePromptCredits?: number
        usedPromptCredits?: number
        availableFlexCredits?: number
        usedFlexCredits?: number
      }
    }
  }

  const ps = data.userStatus?.planStatus
  if (!ps || ps.availablePromptCredits === undefined) {
    throw new Error(
      `响应缺少 planStatus（API Key 可能无效）：${JSON.stringify(data).slice(0, 150)}`
    )
  }
  // credits 单位为百分之一（÷100 显示）；负数 = 无限
  const div = (n?: number) => (typeof n === "number" ? n / 100 : 0)
  const available = div(ps.availablePromptCredits)
  const used = div(ps.usedPromptCredits ?? 0)
  const flexAvailable = div(ps.availableFlexCredits)
  const flexUsed = div(ps.usedFlexCredits ?? 0)

  const windows: QuotaWindow[] = []
  if (ps.availablePromptCredits >= 0) {
    windows.push({
      id: "ws-prompt",
      label: "本月 Prompt 额度",
      usedPercent: pct(used, used + available),
      detail: `${used}/${used + available}`,
    })
  }
  if (ps.availableFlexCredits !== undefined && ps.availableFlexCredits >= 0) {
    windows.push({
      id: "ws-flex",
      label: "Flex 额度",
      usedPercent: pct(flexUsed, flexUsed + flexAvailable),
      detail: `${flexUsed}/${flexUsed + flexAvailable}`,
    })
  }
  if (!windows.length) {
    throw new Error("响应缺少可用额度数据")
  }
  const result: FetchResult = { windows, status: "ok", note: "Windsurf 订阅额度" }
  if (ps.planInfo?.planName) result.plan = ps.planInfo.planName
  return result
}
