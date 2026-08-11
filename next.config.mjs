/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
  },
  // 仅在 Docker 构建时启用 standalone 产物（Dockerfile builder 阶段设置 NEXT_OUTPUT=standalone），
  // 本地 dev / build 保持默认输出，避免相互影响
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // 客户端 bundle 只使用厂商的「数据定义」（VendorDef），从不执行请求逻辑。
      // 但厂商文件会引用 src/lib/http.ts（Node-only：async_hooks / node-fetch / socks 等），
      // 为避免 webpack 在客户端尝试解析 Node 内建模块而编译失败，将它们替换为空壳。
      const stubNode = (name) => {
        config.resolve.alias[name] = false
      }
      const nodeBuiltins = [
        "net", "tls", "dns", "http", "https", "zlib", "stream", "url",
        "util", "buffer", "crypto", "os", "path", "fs", "events", "assert",
        "querystring", "string_decoder", "async_hooks", "child_process",
        "worker_threads", "timers", "constants", "punycode",
      ]
      for (const m of nodeBuiltins) {
        stubNode(m)
        stubNode(`node:${m}`)
      }
      config.resolve.alias["node-fetch"] = false
      config.resolve.alias["https-proxy-agent"] = false
      config.resolve.alias["socks-proxy-agent"] = false
    }
    return config
  },
}

export default nextConfig
