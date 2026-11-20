/**
 * 屏幕保护（防烧屏）：像素位移 + 常态压暗 + 定时息屏 + 亮屏时段
 * - 纯前端能力，只作用于本机浏览器，不落后端、不占用服务端资源
 * - 配置存 localStorage，改动后经自定义事件通知 BurnInGuard 立即生效
 * - 默认关闭：位移会改变渲染图层（文本由次像素抗锯齿降为灰度抗锯齿），需用户显式启用
 */

export const LS_BURN_IN = "ai-usage-burn-in"
export const BURN_IN_EVENT = "ai-usage-burn-in-change"

/** 亮屏时段：区间内正常显示，区间外整屏纯黑（仍保持全屏） */
export interface BurnInSchedule {
  enabled: boolean
  /** 0=周日 … 6=周六，与 Date#getDay 一致 */
  days: number[]
  /** 起始时刻 "HH:MM" */
  start: string
  /** 结束时刻 "HH:MM"，早于 start 表示跨午夜 */
  end: string
}

export interface BurnInConfig {
  enabled: boolean
  /** 位移幅度（px），0 表示只压暗不移位 */
  shiftPx: number
  /** 位移间隔（秒） */
  shiftSec: number
  /** 常态压暗强度 0–0.6 */
  dim: number
  /** 定时息屏周期（分钟），0 表示关闭 */
  restEveryMin: number
  /** 单次息屏时长（秒） */
  restSec: number
  schedule: BurnInSchedule
}

export const SCHEDULE_DEFAULTS: BurnInSchedule = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start: "08:00",
  end: "20:00",
}

export const BURN_IN_DEFAULTS: BurnInConfig = {
  enabled: false,
  shiftPx: 2,
  shiftSec: 60,
  dim: 0.3,
  restEveryMin: 0,
  restSec: 120,
  schedule: SCHEDULE_DEFAULTS,
}

/** 周一在前，便于与中文阅读习惯对齐 */
export const WEEKDAY_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

export const SHIFT_PX_MAX = 4
export const SHIFT_SEC_OPTIONS = [30, 60, 120, 300]
export const REST_CYCLE_OPTIONS = [0, 15, 30, 60]
export const REST_SEC_OPTIONS = [30, 60, 120, 300]

/** 时段外的临时点亮时长（毫秒） */
export const PEEK_MS = 60_000

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** "HH:MM" → 当日分钟数，非法返回 -1 */
function toMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return -1
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return -1
  return h * 60 + m
}

/**
 * 判定某一时刻是否处于亮屏时段。
 * 配置非法、未启用或未选任何星期时一律视为常亮，避免误判成永久黑屏。
 */
export function isAwakeAt(date: Date, schedule: BurnInSchedule): boolean {
  if (!schedule.enabled) return true
  if (schedule.days.length === 0) return true

  const start = toMinutes(schedule.start)
  const end = toMinutes(schedule.end)
  if (start < 0 || end < 0) return true
  if (start === end) return true

  const day = date.getDay()
  const now = date.getHours() * 60 + date.getMinutes()

  if (start < end) {
    return schedule.days.includes(day) && now >= start && now < end
  }
  // 跨午夜：今天 start 之后，或昨天开启的窗口延续到今天 end 之前
  const prevDay = (day + 6) % 7
  return (
    (schedule.days.includes(day) && now >= start) ||
    (schedule.days.includes(prevDay) && now < end)
  )
}

function readSchedule(raw: unknown): BurnInSchedule {
  const p = (raw ?? {}) as Partial<BurnInSchedule>
  const days = Array.isArray(p.days)
    ? p.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : SCHEDULE_DEFAULTS.days
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : SCHEDULE_DEFAULTS.enabled,
    days,
    start: typeof p.start === "string" ? p.start : SCHEDULE_DEFAULTS.start,
    end: typeof p.end === "string" ? p.end : SCHEDULE_DEFAULTS.end,
  }
}

export function readBurnIn(): BurnInConfig {
  try {
    const raw = localStorage.getItem(LS_BURN_IN)
    if (!raw) return { ...BURN_IN_DEFAULTS }
    const p = JSON.parse(raw) as Partial<BurnInConfig>
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : BURN_IN_DEFAULTS.enabled,
      shiftPx: clamp(Number(p.shiftPx), 0, SHIFT_PX_MAX, BURN_IN_DEFAULTS.shiftPx),
      shiftSec: clamp(Number(p.shiftSec), 10, 3600, BURN_IN_DEFAULTS.shiftSec),
      dim: clamp(Number(p.dim), 0, 0.6, BURN_IN_DEFAULTS.dim),
      restEveryMin: clamp(Number(p.restEveryMin), 0, 240, BURN_IN_DEFAULTS.restEveryMin),
      restSec: clamp(Number(p.restSec), 10, 900, BURN_IN_DEFAULTS.restSec),
      schedule: readSchedule(p.schedule),
    }
  } catch {
    return { ...BURN_IN_DEFAULTS }
  }
}

export function writeBurnIn(cfg: BurnInConfig) {
  try {
    localStorage.setItem(LS_BURN_IN, JSON.stringify(cfg))
  } catch {
    // 隐私模式等写入失败时，本次仍通过事件即时生效
  }
  try {
    window.dispatchEvent(new Event(BURN_IN_EVENT))
  } catch {
    // 非浏览器环境（构建期）直接忽略
  }
}
