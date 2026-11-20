"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import {
  BURN_IN_DEFAULTS,
  BURN_IN_EVENT,
  PEEK_MS,
  isAwakeAt,
  readBurnIn,
  type BurnInConfig,
} from "@/lib/burn-in"

/** 8 个方向轮转，任一方向都不会连续停留两拍 */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
]

/** 配置变更的判定精度：15 秒足够覆盖跨时段边界，后台标签页节流也不会误判太久 */
const CLOCK_TICK_MS = 15_000

/**
 * 位移目标：
 * - 全屏时挪 main 内的网格，而不是全屏元素本身 —— 否则遮罩会跟着一起位移，露出边缘缝隙
 * - 非全屏时挪整个页面外壳，报头与卡片一起走
 */
function resolveTarget(): HTMLElement | null {
  const fullscreen = document.fullscreenElement as HTMLElement | null
  if (fullscreen) {
    return document.querySelector<HTMLElement>("[data-burnin-content]") ?? fullscreen
  }
  return document.querySelector<HTMLElement>("[data-burnin-shell]")
}

export function BurnInGuard() {
  const [cfg, setCfg] = useState<BurnInConfig>(BURN_IN_DEFAULTS)
  const [ready, setReady] = useState(false)
  const [resting, setResting] = useState(false)
  const [clock, setClock] = useState(0)
  const [peeking, setPeeking] = useState(false)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const shiftedRef = useRef<HTMLElement | null>(null)
  const peekTimer = useRef(0)

  // 配置来源：首屏读一次，设置面板改动后经事件同步
  useEffect(() => {
    setCfg(readBurnIn())
    setReady(true)
    const onChange = () => setCfg(readBurnIn())
    window.addEventListener(BURN_IN_EVENT, onChange)
    return () => window.removeEventListener(BURN_IN_EVENT, onChange)
  }, [])

  // 时刻源：用于判定是否落在亮屏时段
  useEffect(() => {
    const update = () => setClock(Date.now())
    update()
    const timer = window.setInterval(update, CLOCK_TICK_MS)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  // 遮罩挂载点：全屏元素位于顶层，文档顶层的 fixed 元素会被它盖住，必须挂进全屏节点
  useEffect(() => {
    const sync = () => setHost((document.fullscreenElement as HTMLElement | null) ?? document.body)
    sync()
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  /** 时段外：整屏纯黑但保留全屏，随时钟与配置变化重算 */
  const offAir = clock > 0 && cfg.enabled && !isAwakeAt(new Date(clock), cfg.schedule)
  const blacked = (resting || offAir) && !peeking

  // 回到亮屏时段后清掉残留的临时点亮状态
  useEffect(() => {
    if (!offAir) setPeeking(false)
  }, [offAir])

  useEffect(() => () => window.clearTimeout(peekTimer.current), [])

  const startPeek = useCallback(() => {
    setPeeking(true)
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => setPeeking(false), PEEK_MS)
  }, [])

  // 临时点亮期间，任何交互都把计时器推后一轮 —— 改配置、翻页面时不会被反复掐黑
  useEffect(() => {
    if (!offAir || !peeking) return
    document.addEventListener("pointerdown", startPeek, true)
    document.addEventListener("keydown", startPeek, true)
    return () => {
      document.removeEventListener("pointerdown", startPeek, true)
      document.removeEventListener("keydown", startPeek, true)
    }
  }, [offAir, peeking, startPeek])

  // 像素位移
  useEffect(() => {
    if (!ready) return
    const clearShift = () => {
      const el = shiftedRef.current
      if (!el) return
      el.style.transform = ""
      shiftedRef.current = null
    }
    // 纯黑期间不位移：画面已无内容，且需保证遮罩与视口严格贴合
    if (!cfg.enabled || cfg.shiftPx <= 0 || blacked) {
      clearShift()
      return
    }

    let step = 0
    const tick = () => {
      const el = resolveTarget()
      if (!el) return
      if (el !== shiftedRef.current) {
        clearShift()
        el.style.transition = "transform 800ms ease"
        shiftedRef.current = el
      }
      step = (step + 1) % OFFSETS.length
      const [ox, oy] = OFFSETS[step]
      el.style.transform =
        ox === 0 && oy === 0
          ? ""
          : `translate3d(${ox * cfg.shiftPx}px, ${oy * cfg.shiftPx}px, 0)`
    }

    tick()
    const timer = window.setInterval(tick, cfg.shiftSec * 1000)
    document.addEventListener("fullscreenchange", tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("fullscreenchange", tick)
      clearShift()
    }
  }, [ready, cfg.enabled, cfg.shiftPx, cfg.shiftSec, blacked])

  // 定时息屏：整屏纯黑一段时间，给面板真正的休息窗口（时段外无需重复息屏）
  useEffect(() => {
    if (!ready || !cfg.enabled || offAir || cfg.restEveryMin <= 0) {
      setResting(false)
      return
    }
    let offTimer = 0
    const cycle = window.setInterval(() => {
      setResting(true)
      offTimer = window.setTimeout(() => setResting(false), cfg.restSec * 1000)
    }, cfg.restEveryMin * 60_000)
    return () => {
      window.clearInterval(cycle)
      window.clearTimeout(offTimer)
      setResting(false)
    }
  }, [ready, cfg.enabled, cfg.restEveryMin, cfg.restSec, offAir])

  if (!ready || !host || !cfg.enabled) return null

  return createPortal(
    <div
      aria-hidden="true"
      onClick={blacked ? startPeek : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#000",
        opacity: blacked ? 1 : cfg.dim,
        pointerEvents: blacked ? "auto" : "none",
        transition: "opacity 900ms ease",
      }}
    />,
    host
  )
}
