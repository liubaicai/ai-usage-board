import { authGetJson } from "@/lib/http"
import type { Adapter } from "@/lib/adapters"
import type { Balance, VendorDef } from "@/lib/types"

/**
 * DeepSeek · 按量计费
 * 接入方式：API Key（Bearer 鉴权）
 */
export const deepseek: VendorDef = {
  id: "deepseek",
  name: "DeepSeek",
  vendor: "深度求索",
  kind: "payg",
  authType: "apikey",
  currency: "CNY",
  fields: [
    { key: "apiKey", label: "API Key", placeholder: "sk-...", secret: true, required: true },
  ],
}

/**
 * 余额查询：GET https://api.deepseek.com/user/balance
 * 响应示例：
 * { "is_available": true, "balance_infos": [
 *   { "currency": "CNY", "total_balance": "110.00",
 *     "granted_balance": "10.00", "topped_up_balance": "100.00" } ] }
 */
export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")
  const data = (await authGetJson(
    "https://api.deepseek.com/user/balance",
    key
  )) as {
    is_available?: boolean
    balance_infos?: {
      currency?: string
      total_balance?: string | number
      granted_balance?: string | number
      topped_up_balance?: string | number
    }[]
  }
  const info = data.balance_infos?.[0]
  if (!info) throw new Error("响应缺少 balance_infos")
  const balance: Balance = {
    amount: Number(info.topped_up_balance ?? info.total_balance ?? 0),
    currency: info.currency === "USD" ? "USD" : "CNY",
    granted:
      info.granted_balance !== undefined ? Number(info.granted_balance) : undefined,
    totalBalance:
      info.total_balance !== undefined ? Number(info.total_balance) : undefined,
  }
  return {
    balance,
    status: data.is_available === false ? "error" : "ok",
    note:
      data.is_available === false
        ? "账户不可用，请前往 DeepSeek 充值"
        : "DeepSeek 实时余额",
  }
}
