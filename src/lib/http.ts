/** 带 Bearer 鉴权与超时的 GET JSON 请求（服务端使用） */
const REQUEST_TIMEOUT_MS = 10_000

export async function authGetJson(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 80)}` : ""}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}
