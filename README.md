# ⚡ 能量条 Energy Bar

> 一块牌子上，挂满你所有 AI 订阅的"能量"——剩余用量、限额窗口、账户余额，一眼看完。

**能量条**是一个本地优先的 AI 用量总览面板：把 Codex、Claude Code、GLM、Kimi 这类订阅制的**剩余限额**，与 DeepSeek、OpenRouter、阿里云百炼这类按量付费厂商的**账户余额**，集中展示在一张卡片面板上。支持同厂商多账号、悬浮编辑、全局/单卡两级定时刷新。

界面采用**瑞士国际主义（Swiss International Typographic Style）**设计语言：强网格对齐、Helvetica 系字体、细分割线、黑白灰 + 信号红，支持亮色/暗色双主题。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn--ui-style-000000)

---

## ✨ 主要功能特性

- **多厂商聚合**：订阅制（限额窗口）与按量付费（余额）两类卡片统一展示，厂商目录可扩展
- **同厂商多账号**：厂商与账号分离，一个 Codex 可以挂"主账号 / 团队号"等多个实例，卡片以昵称区分
- **拖拽排序**：卡片可自由拖拽调整顺序（网格内跨行跨列），顺序持久化保存
- **卡片编辑与删除**：卡脚常驻编辑/删除按钮，删除有二次确认弹窗
- **新增接入向导**：选择供应商后按厂商动态渲染配置表单——有的要粘贴 `auth.json`，有的填 API Key，有的要 Cookie，有的还要 OrgID
- **两级定时刷新**：全局统一刷新间隔 + 单卡覆盖（单卡优先），卡片实时显示下次刷新倒计时
- **状态告警**：用量 ≥80% / 余额过低 / 拉取失败时自动标红提示
- **亮暗双主题**：跟随系统偏好，支持手动切换，本地记忆不闪烁
- **凭据本地保存**：所有授权信息仅存于浏览器本地，不上传任何服务器

> ⚠️ 当前用量数据为 **mock 模拟值**（用于演示页面与交互）。真实厂商适配器将按 `AuthType`（`cookie` / `apikey` / `json` / `oauth` / `key+org`）逐个接入。

## 🧰 技术栈

| 类别 | 选型 |
| --- | --- |
| 构建工具 | [Vite 6](https://vite.dev) |
| 框架 | [React 18](https://react.dev) + TypeScript 5.8 |
| 样式 | [Tailwind CSS 4](https://tailwindcss.com)（`@tailwindcss/vite` 插件） |
| 组件体系 | [shadcn/ui](https://ui.shadcn.com) 风格（Radix Slot + CVA，已配置 `components.json`，可直接 `npx shadcn add` 扩展） |
| 图标 | [lucide-react](https://lucide.dev) |
| 设计语言 | 瑞士国际主义（黑白灰 + 信号红 `#E30613`、零圆角、细线分隔、tabular-nums） |

## 🚀 安装与配置

**环境要求**：Node.js ≥ 18，npm ≥ 9

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（默认 http://127.0.0.1:5173）
npm run dev

# 3. 生产构建 & 本地预览
npm run build
npm run preview
```

## 📖 使用方法

1. **新增接入**：点击报头右上角「+ 新增接入」→ 在九宫格中选择供应商 → 按提示填写凭据与昵称 → 添加。
   - 例如 Codex 需要粘贴 `~/.codex/auth.json` 内容；Kimi 需要网页 Cookie；阿里云百炼需要 API Key + OrgID。
2. **编辑 / 删除**：鼠标悬停卡片，点击右上角 ✏️ 按钮即可修改或删除该账号（编辑时厂商不可更换）。
3. **刷新**：
   - **全局刷新间隔**：元信息条右侧下拉统一设定（30 秒 ~ 1 小时，或手动）。
   - **单卡覆盖**：编辑账号时单独设定，`*` 标记且优先于全局。
   - 也可随时点击报头的刷新按钮立即刷新全部。
4. **主题切换**：报头太阳/月亮按钮切换亮暗模式，偏好持久化。

## 📁 项目目录结构

```
ai-usage-board/
├── components.json          # shadcn/ui 配置（别名、样式、CSS 变量）
├── index.html               # 入口 HTML（含暗色防闪烁脚本）
├── package.json
├── tsconfig.json
├── vite.config.ts           # Vite + React + Tailwind v4 插件与 @ 别名
├── LICENSE
└── src/
    ├── main.tsx             # React 挂载入口
    ├── index.css            # Tailwind v4 入口 + 明暗两套设计令牌
    ├── App.tsx              # 布局、状态管理、定时刷新 ticker、持久化
    ├── components/
    │   ├── AccountDialog.tsx  # 新增/编辑/删除账号对话框
    │   ├── ProviderCard.tsx   # 供应商用量卡片（限额进度条 / 余额）
    │   └── ui/                # shadcn 基础组件（button / badge）
    ├── data/
    │   ├── vendors.ts       # 厂商目录：接入方式、配置字段、限额窗口模板
    │   ├── accounts.ts      # 演示种子账号（含同厂商多账号示例）
    │   └── mock.ts          # mock 用量生成与刷新（真实适配器的替换点）
    └── lib/
        ├── types.ts         # 核心类型：VendorDef / Account / QuotaWindow / Balance
        └── utils.ts         # cn() 工具函数
```

## 🤝 贡献指南

欢迎任何形式的贡献！提交前请遵循：

1. 先开 **Issue** 讨论新功能或重大改动，避免返工。
2. Fork 本仓库，在独立分支上开发，分支名建议 `feat/xxx` 或 `fix/xxx`。
3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范，如 `feat: add deepseek adapter`、`fix: countdown drift`。
4. 改动前先跑 `npm run dev` 自测，确保 `tsc --noEmit` 无类型错误。
5. 提交 Pull Request，描述改动动机与影响范围。

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源，Copyright © 2026 刘白菜。

---

*凭据仅存本地 · 用量一目了然* ⚡
