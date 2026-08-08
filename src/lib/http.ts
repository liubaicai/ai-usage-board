import { AsyncLocalStorage } from "async_hooks"
import nodeFetch from "node-fetch"
import type { Response as NodeFetchResponse } from "node-fetch"
import { HttpsProxyAgent } from "https-proxy-agent"
import { SocksProxyAgent } from "socks-proxy-agent"

/**
 * 服务端 HTTP 工具：带超时的 GET/POST JSON。
 * 支持按账号注入 HTTP/SOCKS 代理：fetchAccountUsage 时用 proxyContext.run(proxy)
 * 包住适配器调用，该账号的所有厂商请求自动走代理（无需改厂商文件）。
 */

const REQUEST_TIMEOUT_MS = 10_000

/**
 * 代理上下文：当前请求链路的代理地址（http:// / https:// / socks4:// / socks5://）。
 * 注意：AsyncLocalStorage **延迟初始化**——客户端 bundle 也会加载本模块
 * （经由 vendors → 厂商文件），若在模块顶层 new AsyncLocalStorage()，
 * 客户端会因 async_hooks 为空壳而崩溃（AsyncLocalStorage is not a constructor）。
 * 客户端从不调用本模块函数，懒构造保证只在服务端执行时才实例化。
 */
let als: AsyncLocalStorage<string | undefined> | undefined
function getAls(): AsyncLocalStorage<string | undefined> {
  if (!als) als = new AsyncLocalStorage<string | undefined>()
  return als
}

/** 当前请求链路的代理（无则 undefined） */
export function currentProxy(): string | undefined {
  return als?.getStore()
}

/** 在代理上下文中执行异步函数 */
export async function runWithProxy<T>(
  proxy: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return getAls().run(proxy, fn)
}

type Agent = HttpsProxyAgent<string> | SocksProxyAgent

const agentCache = new Map<string, Agent>()

function getAgent(proxy: string): Agent {
  let agent = agentCache.get(proxy)
  if (!agent) {
    agent = /^socks/i.test(proxy)
      ? new SocksProxyAgent(proxy)
      : new HttpsProxyAgent(proxy)
    agentCache.set(proxy, agent)
  }
  return agent
}

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/** 带代理上下文的 fetch：当前请求若有代理则走代理，否则直连 */
async function proxyFetch(url: string, init: FetchInit): Promise<NodeFetchResponse> {
  const proxy = currentProxy()?.trim()
  if (proxy) {
    return nodeFetch(url, { ...init, agent: getAgent(proxy) })
  }
  return nodeFetch(url, init)
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await proxyFetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 完全自定义请求头的 GET JSON（如 ChatGPT 会话交换） */
export function httpGetJson(
  url: string,
  headers: Record<string, string> = {}
): Promise<unknown> {
  return getJson(url, headers)
}

/** GET 原始文本（响应不是 JSON 时用，如 OpenCode 的 text/javascript 序列化对象） */
export async function httpGetText(
  url: string,
  headers: Record<string, string> = {}
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await proxyFetch(url, { headers, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`)
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** 带鉴权与超时的 GET JSON。
 *  默认 Bearer 鉴权；opts.raw=true 时用裸 Key（智谱 monitor 接口要求）；
 *  opts.headers 追加自定义请求头（如智谱团队版的组织/项目 ID） */
export function authGetJson(
  url: string,
  apiKey: string,
  opts?: { raw?: boolean; headers?: Record<string, string> }
): Promise<unknown> {
  return getJson(url, {
    Authorization: opts?.raw ? apiKey : `Bearer ${apiKey}`,
    ...opts?.headers,
  })
}

/** POST form-urlencoded 并解析 JSON（如 OpenAI token 刷新 / OAuth 设备授权），支持代理 */
export async function postForm(
  url: string,
  body: URLSearchParams,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: body.toString(),
      signal: controller.signal,
    })
    const text = await res.text()
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = { raw: text.slice(0, 200) }
    }
    return { status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}

/** POST JSON 并解析响应（如 Cursor Connect-RPC），支持代理 */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await proxyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
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
