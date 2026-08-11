import { startWorkbuddyAutomationScheduler } from "@/lib/workbuddy-automation"

export function registerNodeInstrumentation(): void {
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build"
  ) {
    return
  }
  startWorkbuddyAutomationScheduler()
}
