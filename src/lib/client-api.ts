import type {
  Account,
  AccountInput,
  AppSettings,
  StateResponse,
} from "@/lib/types"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  getState: () => api<StateResponse>("/api/state"),
  createAccount: (input: AccountInput) =>
    api<Account>("/api/accounts", { method: "POST", body: JSON.stringify(input) }),
  updateAccount: (id: string, input: AccountInput) =>
    api<Account>(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  deleteAccount: (id: string) =>
    api<{ ok: boolean }>(`/api/accounts/${id}`, { method: "DELETE" }),
  reorder: (ids: string[]) =>
    api<Account[]>("/api/accounts/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  setSettings: (globalRefreshSec: number) =>
    api<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ globalRefreshSec }),
    }),
  refreshAccount: (id: string) => api<Account>(`/api/usage/${id}?refresh=1`),
  refreshAll: () => api<Account[]>("/api/usage/refresh-all", { method: "POST" }),

  // Codex OAuth 设备授权
  oauthCodexStart: () =>
    api<{
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }>("/api/oauth/codex", { method: "POST", body: JSON.stringify({}) }),
  oauthCodexPoll: (deviceCode: string) =>
    api<{
      status: "ok" | "pending" | "expired"
      error?: string
      tokens?: { access_token: string; refresh_token?: string; account_id?: string }
    }>("/api/oauth/codex", { method: "POST", body: JSON.stringify({ deviceCode }) }),
}
