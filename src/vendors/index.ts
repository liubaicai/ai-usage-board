import type { Adapter } from "@/lib/adapters"
import type { VendorDef } from "@/lib/types"

import { adapter as antigravityAdapter, antigravity } from "./antigravity"
import { adapter as claudeAdapter, claude } from "./claude"
import { adapter as codexAdapter, codex } from "./codex"
import { adapter as commandcodeAdapter, commandcode } from "./commandcode"
import { adapter as copilotAdapter, copilot } from "./copilot"
import { adapter as cursorAdapter, cursor } from "./cursor"
import { adapter as deepseekAdapter, deepseek } from "./deepseek"
import { adapter as geminiAdapter, gemini } from "./gemini"
import { adapter as kiloAdapter, kilo } from "./kilo"
import { adapter as minimaxAdapter, minimax } from "./minimax"
import { adapter as moonshotAdapter, moonshot } from "./moonshot"
import { adapter as opencodeAdapter, opencode } from "./opencode"
import { adapter as openrouterAdapter, openrouter } from "./openrouter"
import { adapter as relayAdapter, relay } from "./relay"
import { adapter as siliconflowAdapter, siliconflow } from "./siliconflow"
import { adapter as windsurfAdapter, windsurf } from "./windsurf"
import { adapter as workbuddyAdapter, workbuddy } from "./workbuddy"
import { adapter as zhipuCodingAdapter, zhipuCoding } from "./zhipu-coding"

/**
 * 厂商聚合入口。
 * 说明：同一家供应商若有多种接入方式（如订阅 Plan、按量计费），
 * 每种接入方式各占一个独立文件、算作一个"厂商"（vendorId 不同）。
 * 同一接入方式若区分站点（国内/国际），用配置字段（select）选择端点。
 * 新增厂商：在本目录新建一个文件（导出 VendorDef + Adapter），并在下方注册。
 */
export const VENDORS: VendorDef[] = [
  codex,
  antigravity,
  commandcode,
  claude,
  copilot,
  gemini,
  cursor,
  windsurf,
  workbuddy,
  minimax,
  kilo,
  opencode,
  deepseek,
  siliconflow,
  moonshot,
  openrouter,
  zhipuCoding,
  relay,
]

export const VENDOR_MAP: Record<string, VendorDef> = Object.fromEntries(
  VENDORS.map((v) => [v.id, v])
)

/** 厂商适配器注册表：vendorId → Adapter（与厂商文件一一对应） */
export const ADAPTERS: Record<string, Adapter> = {
  [codex.id]: codexAdapter,
  [antigravity.id]: antigravityAdapter,
  [commandcode.id]: commandcodeAdapter,
  [claude.id]: claudeAdapter,
  [copilot.id]: copilotAdapter,
  [gemini.id]: geminiAdapter,
  [cursor.id]: cursorAdapter,
  [windsurf.id]: windsurfAdapter,
  [workbuddy.id]: workbuddyAdapter,
  [minimax.id]: minimaxAdapter,
  [kilo.id]: kiloAdapter,
  [opencode.id]: opencodeAdapter,
  [deepseek.id]: deepseekAdapter,
  [siliconflow.id]: siliconflowAdapter,
  [moonshot.id]: moonshotAdapter,
  [openrouter.id]: openrouterAdapter,
  [relay.id]: relayAdapter,
  [zhipuCoding.id]: zhipuCodingAdapter,
}
