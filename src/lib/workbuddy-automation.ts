import { getStore, saveStore } from "@/lib/store"
import { runWithProxy } from "@/lib/http"
import { refreshAccount } from "@/lib/usage"
import type { Account, WorkbuddyAutomationState } from "@/lib/types"
import {
  checkInWorkbuddy,
  refreshWorkbuddyToken,
  type WorkbuddyCheckinResult,
} from "@/vendors/workbuddy"

const TIME_ZONE = "Asia/Shanghai"
const CHECKIN_MORNING_HOUR = 9
const CHECKIN_RETRY_HOUR = 21
const TOKEN_REFRESH_HOUR = 22
const TICK_MS = 60_000

const accountLocks = new Map<string, Promise<void>>()
let tickInFlight: Promise<void> | null = null

interface ZonedClock {
  date: string
  hour: number
}

function zonedClock(now = new Date()): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ""
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  }
}

function checkinSlot(clock: ZonedClock): string | null {
  if (clock.hour >= CHECKIN_RETRY_HOUR) return `${clock.date}:evening`
  if (clock.hour >= CHECKIN_MORNING_HOUR) return `${clock.date}:morning`
  return null
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 240)
}

function withAccountLock(id: string, task: () => Promise<void>): Promise<void> {
  const previous = accountLocks.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  accountLocks.set(id, current)
  return current.finally(() => {
    if (accountLocks.get(id) === current) accountLocks.delete(id)
  })
}

async function latestAccount(id: string): Promise<Account | undefined> {
  return (await getStore()).accounts.find((account) => account.id === id)
}

async function saveCheckinResult(
  id: string,
  slot: string,
  date: string,
  result: WorkbuddyCheckinResult
): Promise<void> {
  const now = Date.now()
  await saveStore((store) => {
    const account = store.accounts.find((item) => item.id === id)
    if (!account) return
    const current = account.workbuddyAutomation ?? {}
    const succeeded = result.status === "success" || result.status === "already"
    account.workbuddyAutomation = {
      ...current,
      checkin: {
        lastAttemptSlot: slot,
        lastSuccessDate: succeeded ? date : current.checkin?.lastSuccessDate,
        status: result.status,
        message: result.message,
        updatedAt: now,
        streakDays: result.streakDays,
        todayCredit: result.todayCredit,
      },
      tokenRefresh: result.configUpdate
        ? {
            lastAttemptDate: date,
            lastSuccessDate: date,
            status: "success",
            message: "token 已在签到前刷新",
            updatedAt: now,
          }
        : current.tokenRefresh,
    }
    if (result.configUpdate) {
      account.config = { ...account.config, ...result.configUpdate }
    }
  })
}

async function saveCheckinError(
  id: string,
  slot: string,
  state: WorkbuddyAutomationState | undefined,
  error: unknown
): Promise<void> {
  await saveStore((store) => {
    const account = store.accounts.find((item) => item.id === id)
    if (!account) return
    account.workbuddyAutomation = {
      ...(account.workbuddyAutomation ?? state),
      checkin: {
        lastAttemptSlot: slot,
        lastSuccessDate: account.workbuddyAutomation?.checkin?.lastSuccessDate,
        status: "error",
        message: errorMessage(error),
        updatedAt: Date.now(),
      },
    }
  })
}

async function runCheckin(accountId: string, clock: ZonedClock, slot: string): Promise<void> {
  const account = await latestAccount(accountId)
  if (!account || account.vendorId !== "workbuddy" || account.config.autoCheckin === "false") {
    return
  }
  const state = account.workbuddyAutomation
  if (state?.checkin?.lastSuccessDate === clock.date || state?.checkin?.lastAttemptSlot === slot) {
    return
  }

  try {
    const result = await runWithProxy(account.config.proxy?.trim() || undefined, () =>
      checkInWorkbuddy(account.config)
    )
    await saveCheckinResult(account.id, slot, clock.date, result)
    if (result.status === "success") await refreshAccount(account.id)
  } catch (error) {
    await saveCheckinError(account.id, slot, state, error)
    console.error(`[WorkBuddy] ${account.label} 自动签到失败：${errorMessage(error)}`)
  }
}

async function runTokenRefresh(accountId: string, clock: ZonedClock): Promise<void> {
  const account = await latestAccount(accountId)
  if (!account || account.vendorId !== "workbuddy") return
  const state = account.workbuddyAutomation
  if (
    state?.tokenRefresh?.lastSuccessDate === clock.date ||
    state?.tokenRefresh?.lastAttemptDate === clock.date
  ) {
    return
  }

  try {
    const result = await runWithProxy(account.config.proxy?.trim() || undefined, () =>
      refreshWorkbuddyToken(account.config)
    )
    await saveStore((store) => {
      const latest = store.accounts.find((item) => item.id === account.id)
      if (!latest) return
      latest.config = { ...latest.config, ...result.configUpdate }
      latest.workbuddyAutomation = {
        ...(latest.workbuddyAutomation ?? state),
        tokenRefresh: {
          lastAttemptDate: clock.date,
          lastSuccessDate: clock.date,
          status: "success",
          message: "每日 token 刷新成功",
          updatedAt: Date.now(),
        },
      }
    })
  } catch (error) {
    await saveStore((store) => {
      const latest = store.accounts.find((item) => item.id === account.id)
      if (!latest) return
      latest.workbuddyAutomation = {
        ...(latest.workbuddyAutomation ?? state),
        tokenRefresh: {
          lastAttemptDate: clock.date,
          lastSuccessDate: latest.workbuddyAutomation?.tokenRefresh?.lastSuccessDate,
          status: "error",
          message: errorMessage(error),
          updatedAt: Date.now(),
        },
      }
    })
    console.error(`[WorkBuddy] ${account.label} 每日 token 刷新失败：${errorMessage(error)}`)
  }
}

export async function runWorkbuddyAutomationTick(now = new Date()): Promise<void> {
  const clock = zonedClock(now)
  const slot = checkinSlot(clock)
  const accounts = (await getStore()).accounts.filter((account) => account.vendorId === "workbuddy")
  await Promise.all(
    accounts.map((account) =>
      withAccountLock(account.id, async () => {
        if (slot) await runCheckin(account.id, clock, slot)
        if (clock.hour >= TOKEN_REFRESH_HOUR) await runTokenRefresh(account.id, clock)
      })
    )
  )
}

type SchedulerGlobal = typeof globalThis & {
  __workbuddyAutomationTimer?: ReturnType<typeof setInterval>
}

export function startWorkbuddyAutomationScheduler(): void {
  if (process.env.WORKBUDDY_AUTOMATION_DISABLED === "1") return
  const globalScheduler = globalThis as SchedulerGlobal
  if (globalScheduler.__workbuddyAutomationTimer) return

  const tick = () => {
    if (tickInFlight) return
    tickInFlight = runWorkbuddyAutomationTick()
      .catch((error) => {
        console.error(`[WorkBuddy] 自动任务执行失败：${errorMessage(error)}`)
      })
      .finally(() => {
        tickInFlight = null
      })
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  globalScheduler.__workbuddyAutomationTimer = timer
}
