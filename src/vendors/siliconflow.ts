import { authGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { Balance, VendorDef } from "@/lib/types"

/**
 * SiliconFlow · 按量计费
 * 接入方式：API Key（Bearer 鉴权）
 */
export const siliconflow: VendorDef = {
  id: "siliconflow",
  name: "SiliconFlow",
  vendor: "硅基流动",
  kind: "payg",
  authType: "apikey",
  currency: "CNY",
  fields: [
    { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
  ],
}

/**
 * 余额查询：GET https://api.siliconflow.cn/v1/user/info
 * 响应示例：
 * { "code": 20000, "status": true, "data": {
 *   "balance": "0.88", "chargeBalance": "88.00", "totalBalance": "88.88" } }
 * balance=赠送余额，chargeBalance=充值余额（可花费），totalBalance=合计
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const data = (await authGetJson(
    "https://api.siliconflow.cn/v1/user/info",
    key
  )) as {
    code?: number
    message?: string
    data?: {
      balance?: string | number
      chargeBalance?: string | number
      totalBalance?: string | number
    }
  }
  if (data.code !== 20000 || !data.data) {
    throw new Error(`接口异常：${data.message ?? "未知"}`)
  }
  const d = data.data
  const balance: Balance = {
    amount: Number(d.chargeBalance ?? d.totalBalance ?? d.balance ?? 0),
    currency: "CNY",
    granted: d.balance !== undefined ? Number(d.balance) : undefined,
    totalBalance: d.totalBalance !== undefined ? Number(d.totalBalance) : undefined,
  }
  return { balance, status: "ok", note: "SiliconFlow 实时余额" }
}
