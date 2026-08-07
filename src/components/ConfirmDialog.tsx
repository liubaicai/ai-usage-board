"use client"

import { useEffect } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

/** 瑞士风格的确认弹窗，用于删除等危险操作 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "删除",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm border-2 border-foreground bg-background"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="block h-3 w-3 bg-accent" aria-hidden />
            <h2 className="text-sm font-bold uppercase tracking-[0.2em]">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            aria-label="关闭"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <p className="px-5 py-5 text-sm leading-relaxed">{description}</p>

        {/* 底栏 */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            className="bg-accent text-white hover:bg-accent/90"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
