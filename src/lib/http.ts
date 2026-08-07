/** 带鉴权与超时的 GET JSON 请求（服务端使用）。
 *  默认 Bearer 鉴权；opts.raw=true 时用裸 Key（智谱 monitor 接口要求）；
 *  opts.headers 追加自定义请求头（如智谱团队版的组织/项目 ID） */
const REQUEST_TIMEOUT_MS = 10_000

export async function authGetJson(
  url: string,
  apiKey: string,
  opts?: { raw?: boolean; headers?: Record<string, string> }
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: opts?.raw ? apiKey : `Bearer ${apiKey}`,
        ...opts?.headers,
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}
