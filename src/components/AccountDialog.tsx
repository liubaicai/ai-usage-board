"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { VENDORS, VENDOR_MAP } from "@/vendors"
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
  const [refreshSec, setRefreshSec] = useState<string>("inherit")

  // 打开时初始化表单
  useEffect(() => {
    if (!open) return
    if (initial) {
      setVendorId(initial.vendorId)
      setLabel(initial.label)
      setPlan(initial.plan ?? "")
      setConfig({ ...initial.config })
      setRefreshSec(initial.refreshSec === null ? "inherit" : String(initial.refreshSec))
    } else {
      setVendorId(VENDORS[0].id)
      setLabel("")
      setPlan("")
      setConfig({})
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

  if (!open) return null

  const vendor = VENDOR_MAP[vendorId]
  // 必填校验：密钥已保存在后端（哨兵/旧值存在）时允许留空
  const missingRequired = vendor.fields.some((f) => {
    if (!f.required) return false
    const v = (config[f.key] ?? "").trim()
    if (v && v !== KEEP_SECRET) return false
    if (editing && f.secret && initial?.config[f.key]) return false
    return true
  })

  const handleSave = () => {
    const sec = refreshSec === "inherit" ? null : Number(refreshSec)
    // 密钥留空且原本已保存 → 发 KEEP_SECRET，后端保持不变
    const out: Record<string, string> = {}
    for (const f of vendor.fields) {
      const raw = config[f.key] ?? ""
      if (f.secret && !raw.trim() && editing && initial?.config[f.key]) {
        out[f.key] = KEEP_SECRET
      } else {
        out[f.key] = raw
      }
    }
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
        className="flex max-h-[85vh] w-full max-w-xl flex-col border-2 border-foreground bg-background"
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
              <div className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3">
                {VENDORS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setVendorId(v.id)
                      setConfig({})
                    }}
                    className={cn(
                      "flex flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors",
                      v.id === vendorId
                        ? "bg-foreground text-background"
                        : "bg-background hover:bg-secondary"
                    )}
                  >
                    <span className="text-xs font-bold leading-tight">{v.name}</span>
                    <span
                      className={cn(
                        "text-[9px] uppercase tracking-[0.12em]",
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

          {/* 昵称 + 套餐 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>账号昵称</label>
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

          {/* 厂商特定配置字段 */}
          {vendor.fields.map((f) => (
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
