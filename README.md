# 🪺 Nest

> AI-powered Chrome bookmark organizer — let your bookmarks work for you.

[中文](#中文介绍) | [English](#english)

---

## English

Nest is a Chrome extension that uses AI to automatically categorize and reorganize your bookmarks. Instead of spending hours manually sorting hundreds of links, just click "AI Group" and let Nest do the work.

### Features

- **AI Smart Grouping** — Analyzes bookmark titles and URLs to generate meaningful groups. Works on any folder, not just the whole bookmark bar.
- **Adjustable Creativity** — Control the AI temperature to get stable results or surprising new perspectives every time.
- **Visual Bookmark Tree** — Full sidebar view with search, drag-to-reorder, inline editing, and folder move support.
- **Group Editor** — Review and adjust AI results before applying: rename groups, move bookmarks between groups, add/remove groups manually.
- **Version History** — Auto-saves a snapshot after every apply. Manual saves are never auto-deleted. Restore any version with one click.
- **Pending Folder** — Unclassified bookmarks go to a "Pending" folder that acts as a staging area. Re-run AI on it to gradually move everything into proper folders.

### Tech Stack

- **Vue 3** + Element Plus
- **LangGraph** (LangChain) for AI workflow orchestration
- **Vite** for building
- Compatible with any OpenAI-compatible API (Alibaba Qwen, OpenAI, DeepSeek, etc.)

### Getting Started

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

Load the `dist/` folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

### Configuration

Create a `.env` file in the project root:

```env
VITE_LLM_API_KEY=your_api_key_here
VITE_LLM_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
VITE_LLM_MODEL=qwen-plus
```

You can also configure everything directly in the extension's Settings tab.

### Privacy

All bookmark data stays local. Only bookmark titles and URLs are sent to the AI API you configure. No data is collected or stored externally.

---

## 中文介绍

Nest 是一款 Chrome 书签整理扩展，借助 AI 自动分析并重新归类你的书签。不需要手动一条条整理，点击「AI 分组」，几秒钟完成。

### 功能特性

- **AI 智能分组** — 分析书签标题和 URL，自动生成有意义的分组名称。支持对任意目录单独分组，不限于整个书签栏。
- **创意度可调** — 通过温度参数控制 AI 的发散程度，每次都能得到不同视角的分组结果。
- **可视化书签树** — 侧边栏完整展示书签结构，支持搜索、拖拽排序、内联编辑、目录移动。
- **分组结果编辑** — 应用前自由调整：修改分组名称、移动书签、手动增删分组。
- **版本历史** — 每次应用分组自动保存快照，手动保存的版本永久保留不被自动清除，一键恢复任意版本。
- **待分类暂存区** — AI 无法确定归属的书签进入「待分类」目录，可随时对其再次 AI 分组，逐步清空。

### 技术栈

- **Vue 3** + Element Plus
- **LangGraph**（LangChain）AI 工作流编排
- **Vite** 构建
- 兼容任意 OpenAI 兼容接口（阿里云百炼、OpenAI、DeepSeek 等）

### 快速开始

```bash
npm install
npm run dev    # 开发模式（监听文件变化）
npm run build  # 生产构建
```

在 Chrome 扩展管理页（`chrome://extensions`）开启开发者模式，加载 `dist/` 目录即可。

### 配置

在项目根目录创建 `.env` 文件：

```env
VITE_LLM_API_KEY=你的 API Key
VITE_LLM_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
VITE_LLM_MODEL=qwen-plus
```

也可以直接在扩展的「配置」Tab 里设置。

### 隐私说明

所有书签数据仅在本地处理。AI 分析时只发送书签标题和 URL 到你配置的 AI 服务，不收集任何数据。

---

## License

MIT
