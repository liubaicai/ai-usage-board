"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { VENDORS, VENDOR_MAP } from "@/vendors"
import { apiClient } from "@/lib/client-api"
import { cn } from "@/lib/utils"
import {
  AUTH_LABEL,
  KEEP_SECRET,
  REFRESH_OPTIONS,
  type Account,
  type AccountInput,
  type ConfigField,
} from "@/lib/types"

const inputCls =
  "w-full border border-border bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-foreground"
const labelCls =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"

function Field({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: string
  onChange: (v: string) => void
}) {
  // 密钥已保存在后端：留空表示保持不变
  const isSavedSecret = field.secret && value === KEEP_SECRET
  const display = isSavedSecret ? "" : value
  const placeholder = isSavedSecret ? "已保存，留空则不修改" : field.placeholder
  if (field.options) {
    return (
      <select
        className={cn(inputCls, "appearance-none")}
        value={display}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (field.multiline) {
    return (
      <textarea
        className={cn(inputCls, "min-h-20 resize-y font-mono text-xs")}
        placeholder={placeholder}
        value={display}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    )
  }
  return (
    <input
      type={field.secret ? "password" : "text"}
      className={cn(inputCls, field.secret && "font-mono")}
      placeholder={placeholder}
      value={display}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
    />
  )
}

interface AccountDialogProps {
  open: boolean
  /** null = 新增模式；编辑时 config 中密钥为 KEEP_SECRET 哨兵 */
  initial: Account | null
  onClose: () => void
  onSave: (input: AccountInput) => void
}

export function AccountDialog({ open, initial, onClose, onSave }: AccountDialogProps) {
  const editing = initial !== null
  const [vendorId, setVendorId] = useState(VENDORS[0].id)
  const [label, setLabel] = useState("")
  const [plan, setPlan] = useState("")
  const [config, setConfig] = useState<Record<string, string>>({})
  const [proxy, setProxy] = useState("")
  const [refreshSec, setRefreshSec] = useState<string>("inherit")
  // OAuth 设备授权状态（codex / copilot 通用）
  const [oauthFlow, setOauthFlow] = useState<{
    flow: "codex" | "copilot" | "workbuddy"
    deviceCode: string
    userCode: string
    verificationUri: string
    interval: number
  } | null>(null)
  const [oauthError, setOauthError] = useState("")
  const [oauthDone, setOauthDone] = useState(false)

  // 新建时给下拉字段（如区域/授权方式）填默认值
  const vendorDefaults = (v: (typeof VENDORS)[number]) => {
    const defaults: Record<string, string> = {}
    for (const f of v.fields) {
      if (f.options?.length && !f.secret) defaults[f.key] = f.options[0].value
    }
    return defaults
  }

  // 打开时初始化表单
  useEffect(() => {
    if (!open) return
    setOauthFlow(null)
    setOauthError("")
    setOauthDone(false)
    if (initial) {
      setVendorId(initial.vendorId)
      setLabel(initial.label)
      setPlan(initial.plan ?? "")
      setConfig({ ...initial.config })
      setProxy(initial.config.proxy ?? "")
      setRefreshSec(initial.refreshSec === null ? "inherit" : String(initial.refreshSec))
    } else {
      setVendorId(VENDORS[0].id)
      setLabel("")
      setPlan("")
      setConfig(vendorDefaults(VENDORS[0]))
      setProxy("")
      setRefreshSec("inherit")
    }
  }, [open, initial])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // OAuth 设备授权：轮询授权结果（动态间隔——GitHub slow_down 时会要求递增等待），
  // 成功后把凭证写入 content（codex → auth.json 形态；copilot → GitHub token）
  useEffect(() => {
    if (!open || !oauthFlow || oauthDone) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let nextMs = (oauthFlow.interval || 5) * 1000
      try {
        const r =
          oauthFlow.flow === "copilot"
            ? await apiClient.oauthCopilotPoll(oauthFlow.deviceCode, proxy)
            : oauthFlow.flow === "workbuddy"
              ? await apiClient.oauthWorkbuddyPoll(oauthFlow.deviceCode, proxy)
              : await apiClient.oauthCodexPoll(oauthFlow.deviceCode, proxy)
        if (cancelled) return
        if (r.status === "ok") {
          if (oauthFlow.flow === "workbuddy") {
            const wr = r as {
              accessToken?: string
              refreshToken?: string
              uid?: string
              email?: string
              nickname?: string
              enterpriseId?: string
              domain?: string
            }
            setConfig((c) => ({
              ...c,
              content: JSON.stringify({
                access_token: wr.accessToken,
                refresh_token: wr.refreshToken,
                uid: wr.uid,
                email: wr.email,
                nickname: wr.nickname,
                enterprise_id: wr.enterpriseId,
                domain: wr.domain,
              }),
            }))
          } else {
            setConfig((c) => ({
              ...c,
              content:
                oauthFlow.flow === "copilot"
                  ? JSON.stringify({ githubToken: (r as { githubToken?: string }).githubToken })
                  : JSON.stringify({
                      tokens: {
                        access_token: (r as { tokens?: { access_token: string } }).tokens
                          ?.access_token,
                        refresh_token: (r as { tokens?: { refresh_token?: string } }).tokens
                          ?.refresh_token,
                        account_id: (r as { tokens?: { account_id?: string } }).tokens
                          ?.account_id,
                      },
                    }),
            }))
          }
          setOauthDone(true)
          setOauthFlow(null)
          return
        }
        if (r.status === "expired") {
          setOauthError("授权已过期，请重新开始")
          setOauthFlow(null)
          return
        }
        // pending：采用服务端建议的间隔（GitHub slow_down 会返回递增 interval）
        if (typeof r.interval === "number" && r.interval > 0) {
          nextMs = r.interval * 1000
        }
      } catch (e) {
        // 网络/服务端瞬时错误，继续轮询；记录首个错误便于排查
        setOauthError((prev) =>
          prev || (e instanceof Error ? `授权轮询出错：${e.message}` : "授权轮询出错")
        )
      }
      if (!cancelled) {
        timer = setTimeout(tick, nextMs)
      }
    }
    timer = setTimeout(tick, (oauthFlow.interval || 5) * 1000)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [open, oauthFlow, oauthDone, proxy])

  const startOauth = async () => {
    setOauthError("")
    try {
      if (vendorId === "workbuddy") {
        const r = await apiClient.oauthWorkbuddyStart(proxy)
        setOauthFlow({
          flow: "workbuddy",
          deviceCode: r.state,
          userCode: "",
          verificationUri: r.verification_uri,
          interval: r.interval || 2,
        })
        return
      }
      const flow = vendorId === "copilot" ? "copilot" : "codex"
      const r =
        flow === "copilot"
          ? await apiClient.oauthCopilotStart(proxy)
          : await apiClient.oauthCodexStart(proxy)
      setOauthFlow({
        flow,
        deviceCode: r.device_code,
        userCode: r.user_code,
        verificationUri: r.verification_uri,
        interval: r.interval || 5,
      })
    } catch (e) {
      setOauthError(e instanceof Error ? e.message : "发起 OAuth 授权失败")
    }
  }

  if (!open) return null

  const vendor = VENDOR_MAP[vendorId]
  // 条件显示：dependsOn 字段仅在 config[key] 命中 value/values 之一时展示
  const isDepVisible = (f: ConfigField) => {
    if (!f.dependsOn) return true
    const d = f.dependsOn
    const allowed = d.values ?? (d.value ? [d.value] : [])
    return allowed.includes(config[d.key] ?? "")
  }
  const visibleFields = vendor.fields.filter(isDepVisible)
  const missingRequired = visibleFields.some((f) => {
    if (!f.required) return false
    const v = (config[f.key] ?? "").trim()
    if (v && v !== KEEP_SECRET) return false
    if (editing && f.secret && initial?.config[f.key]) return false
    return true
  })

  const handleSave = () => {
    const sec = refreshSec === "inherit" ? null : Number(refreshSec)
    // 密钥留空且原本已保存 → 发 KEEP_SECRET，后端保持不变；
    // 隐藏字段（dependsOn 不满足）保留当前/旧值（如 OAuth 自动写入的 content）
    const out: Record<string, string> = {}
    for (const f of vendor.fields) {
      if (!isDepVisible(f)) {
        const cur = config[f.key]
        out[f.key] = cur !== undefined && cur !== "" ? cur : (initial?.config[f.key] ?? "")
        continue
      }
      const raw = config[f.key] ?? ""
      if (f.secret && !raw.trim() && editing && initial?.config[f.key]) {
        out[f.key] = KEEP_SECRET
      } else {
        out[f.key] = raw
      }
    }
    // 代理地址（可选）：所有厂商通用，不参与厂商字段的密钥哨兵逻辑
    out.proxy = proxy.trim()
    onSave({
      vendorId,
      label: label.trim() || vendor.name,
      plan: plan.trim() || vendor.defaultPlan,
      config: out,
      refreshSec: sec,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col border-2 border-foreground bg-popover"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="block h-3 w-3 bg-accent" aria-hidden />
            <h2 className="text-sm font-bold uppercase tracking-[0.2em]">
              {editing ? "编辑接入" : "新增接入"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 表单主体 */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* 厂商选择：编辑模式锁定 */}
          <div>
            <span className={labelCls}>供应商</span>
            {editing ? (
              <div className="border border-border px-3 py-2.5 text-sm font-medium">
                {vendor.name}
                <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {vendor.vendor} · {AUTH_LABEL[vendor.authType]}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-px border border-border bg-border sm:grid-cols-4">
                {VENDORS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setVendorId(v.id)
                      setConfig(vendorDefaults(v))
                    }}
                    className={cn(
                      "flex flex-col items-start gap-0 px-2.5 py-1.5 text-left transition-colors",
                      v.id === vendorId
                        ? "bg-foreground text-background"
                        : "bg-background hover:bg-secondary"
                    )}
                  >
                    <span className="truncate text-[11px] font-bold leading-tight">{v.name}</span>
                    <span
                      className={cn(
                        "text-[9px] uppercase tracking-[0.1em]",
                        v.id === vendorId ? "text-background/70" : "text-muted-foreground"
                      )}
                    >
                      {AUTH_LABEL[v.authType]} · {v.kind === "subscription" ? "订阅" : "按量"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 名称 + 套餐 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>名称</label>
              <input
                className={inputCls}
                placeholder={`如：主账号 / 小号（默认 ${vendor.name}）`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>套餐</label>
              <input
                className={inputCls}
                placeholder={vendor.defaultPlan ?? "如：Pro / Plus"}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </div>
          </div>

          {/* 厂商特定配置字段（dependsOn 条件字段按需展示） */}
          {visibleFields.map((f) => (
            <div key={f.key}>
              <label className={labelCls}>
                {f.label}
                {f.required && <span className="ml-1 text-accent">*</span>}
              </label>
              <Field
                field={f}
                value={config[f.key] ?? ""}
                onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))}
              />
            </div>
          ))}

          {/* 代理地址（可选）：所有接入通用，填写后该接入的请求全部走代理 */}
          <div>
            <label className={labelCls}>代理（可选）</label>
            <input
              className={inputCls}
              placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080（留空直连）"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="mt-1.5 text-[10px] tracking-[0.08em] text-muted-foreground">
              该接入的厂商请求（含 token 自动刷新）将通过此代理发出，支持 HTTP / SOCKS4 / SOCKS5。
            </p>
          </div>

          {/* OAuth 设备授权面板（Codex / GitHub Copilot） */}
          {(vendor.oauthFlow === "codex" && config.authMethod === "oauth") ||
            (vendor.oauthFlow === "copilot" && config.authMethod === "device-flow") ||
            (vendor.oauthFlow === "workbuddy" && config.authMethod === "oauth") ? (
            <div>
              <span className={labelCls}>
                {vendor.oauthFlow === "workbuddy" ? "OAuth 浏览器授权" : "OAuth 设备授权"}
              </span>
              {oauthDone ? (
                <div className="border border-accent px-3 py-2.5 text-xs">
                  ✓ 已获取凭证，点击「保存」完成添加
                </div>
              ) : oauthFlow ? (
                <div className="space-y-2.5 border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      浏览器打开
                    </span>
                    <a
                      href={oauthFlow.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-accent underline"
                    >
                      {oauthFlow.verificationUri}
                    </a>
                  </div>
                  {oauthFlow.userCode && (
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        输入代码
                      </span>
                      <span className="text-2xl font-black tracking-[0.25em] tabular-nums">
                        {oauthFlow.userCode}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] tracking-[0.08em] text-muted-foreground">
                    {vendor.oauthFlow === "workbuddy"
                      ? "在浏览器完成登录后自动获取凭证，无需其他操作"
                      : "授权完成后自动获取凭证，无需其他操作"}
                  </p>
                </div>
              ) : (
                <Button size="sm" onClick={() => void startOauth()}>
                  开始 OAuth 授权
                </Button>
              )}
              {oauthError && (
                <p className="mt-1.5 text-[10px] tracking-[0.08em] text-accent">{oauthError}</p>
              )}
            </div>
          ) : null}

          {/* 单卡刷新间隔 */}
          <div>
            <label className={labelCls}>刷新间隔</label>
            <select
              className={cn(inputCls, "appearance-none")}
              value={refreshSec}
              onChange={(e) => setRefreshSec(e.target.value)}
            >
              <option value="inherit">跟随全局</option>
              {REFRESH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] tracking-[0.08em] text-muted-foreground">
              单卡设置优先于全局刷新间隔；凭据仅保存在后端服务器。
            </p>
          </div>
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-end border-t border-border px-5 py-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" onClick={handleSave} disabled={missingRequired}>
              {editing ? "保存" : "添加"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
