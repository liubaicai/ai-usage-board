import { httpGetJson } from "@/lib/http"
import type { Adapter, FetchResult } from "@/lib/adapters"
import type { QuotaWindow, VendorDef } from "@/lib/types"

/**
 * Kilo（Kilo Code / Kilo Pass）· 订阅制（credits）
 * 接入方式：API Key（Kilo Pass 账户的 API token）
 * 接口（CodexBar 逆向，tRPC batch GET）：
 *   https://app.kilo.ai/api/trpc/<proc1>,<proc2>,<proc3>?batch=1&input={"0":{"json":null},...}
 *   procedures: user.getCreditBlocks / kiloPass.getState / user.getAutoTopUpPaymentMethod
 *   Headers: Authorization: Bearer <key>，可选 X-KILOCODE-ORGANIZATIONID
 * 响应（tRPC batch）：[{ result: { data: { json: ... } } }, ...]
 * 单位：美元（creditBlocks 为微美元 ÷1e6）
 */
export const kilo: VendorDef = {
  id: "kilo",
  name: "Kilo",
  vendor: "Kilo",
  kind: "subscription",
  authType: "apikey",
  currency: "USD",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "Kilo Pass 账户的 API token（KILO_API_KEY）",
      secret: true,
      required: true,
    },
  ],
}

const TRPC_BASE = "https://app.kilo.ai/api/trpc"
const PROCEDURES = [
  "user.getCreditBlocks",
  "kiloPass.getState",
  "user.getAutoTopUpPaymentMethod",
]

function buildBatchUrl(): string {
  const input = JSON.stringify({
    0: { json: null },
    1: { json: null },
    2: { json: null },
  })
  return `${TRPC_BASE}/${PROCEDURES.join(",")}?batch=1&input=${encodeURIComponent(input)}`
}

function num(o: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!o) return undefined
  for (const k of keys) {
    const v = o[k]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v)
    }
  }
  return undefined
}

function dateNum(o: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!o) return undefined
  for (const k of keys) {
    const v = o[k]
    if (typeof v === "number" && v > 0) return v
    if (typeof v === "string") {
      const t = Date.parse(v)
      if (!Number.isNaN(t)) return t
    }
  }
  return undefined
}

/** 从 tRPC batch 响应中提取第 idx 个 procedure 的 payload */
function batchPayload(batch: unknown, idx: number): Record<string, unknown> | undefined {
  if (!Array.isArray(batch)) return undefined
  const entry = batch[idx] as Record<string, unknown> | undefined
  if (!entry) return undefined
  const result = entry.result as Record<string, unknown> | undefined
  const data = result?.data as Record<string, unknown> | undefined
  const json = data?.json
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>
  }
  if (json && Array.isArray(json)) {
    // payload 数组 → 若第一个是对象则返回对象包裹
    if (json[0] && typeof json[0] === "object") {
      return { items: json }
    }
  }
  return undefined
}

export const adapter: Adapter = async (config) => {
  const key = config.apiKey?.trim()
  if (!key) throw new Error("缺少 API Key，请在编辑中填写")

  const batch = (await httpGetJson(buildBatchUrl(), {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  })) as unknown

  // kiloPass.getState（index 1）优先：subscription 字段
  const pass = batchPayload(batch, 1)
  const sub = (pass?.subscription ?? pass) as Record<string, unknown> | undefined
  const usedRaw = num(sub, ["currentPeriodUsageUsd", "used", "usedCredits", "consumed", "spent", "creditsUsed"])
  const baseCredits = num(sub, ["currentPeriodBaseCreditsUsd", "total", "totalCredits", "creditsTotal", "limit"])
  const bonusCredits = num(sub, ["currentPeriodBonusCreditsUsd", "bonus", "bonusCredits"]) ?? 0
  const resetsAt = dateNum(sub, ["nextBillingAt", "nextRenewalAt", "renewsAt", "renewAt"])
  const planName =
    typeof sub?.planName === "string"
      ? String(sub.planName)
      : typeof sub?.plan === "string"
        ? String(sub.plan)
        : undefined

  // creditBlocks（index 0）兜底：amount_mUsd / balance_mUsd
  let used = usedRaw
  let remaining: number | undefined
  if (used === undefined) {
    const cb = batchPayload(batch, 0)
    const blocks = (cb?.creditBlocks ?? cb?.items ?? []) as Record<string, unknown>[]
    let totalBlocks = 0
    let remainBlocks = 0
    for (const b of blocks) {
      const amt = num(b, ["amount_mUsd"])
      const bal = num(b, ["balance_mUsd"])
      if (amt !== undefined) totalBlocks += amt / 1_000_000
      if (bal !== undefined) remainBlocks += bal / 1_000_000
    }
    if (totalBlocks > 0) {
      used = totalBlocks - remainBlocks
      remaining = remainBlocks
    }
  }
  if (used === undefined && remaining === undefined) {
    remaining = num(sub, ["remaining", "remainingCredits", "creditsRemaining"])
  }

  const total = baseCredits !== undefined ? baseCredits + bonusCredits : undefined
  const finalUsed = used ?? (total !== undefined && remaining !== undefined ? total - remaining : undefined)
  if (finalUsed === undefined || total === undefined || total <= 0) {
    throw new Error(
      `响应缺少用量数据（API Key 可能无效或无 Kilo Pass 订阅）：${JSON.stringify(batch).slice(0, 180)}`
    )
  }

  const usedPercent = Math.min(100, Math.max(0, Math.round((finalUsed / total) * 100)))
  const windows: QuotaWindow[] = [
    {
      id: "kilo-cycle",
      label: "本月额度",
      usedPercent,
      resetIn:
        resetsAt !== undefined
          ? (() => {
              const ms = resetsAt - Date.now()
              if (ms <= 0) return "即将重置"
              const d = Math.ceil(ms / 86_400_000)
              return d > 1 ? `${d} 天后` : `${Math.floor(ms / 3_600_000)}h 后`
            })()
          : undefined,
      detail: `$${finalUsed.toFixed(2)}/${total.toFixed(2)}`,
    },
  ]
  const result: FetchResult = { windows, status: "ok", note: "Kilo Pass 用量" }
  if (planName) result.plan = planName
  return result
}
