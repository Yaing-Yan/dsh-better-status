# dsh-better-status

> DeepSeek Harness 插件：把底部那行「1 轮 · 2 步 | LLM 1m38s · 工具调用 0.2s | 首 token 平均 42.4s · 8.2 tok/s | 缓存命中 0% | 输入 18.4K tok · 输出 109」文本统计，替换成页面右侧**直观、醒目**、**每秒自动刷新**的图表面板，并额外显示**本次花费**与 **DeepSeek 账户余额**。

A real (auto-loading) [DeepSeek Harness](https://github.com/deepseek-ai) plugin that replaces the plain-text session stats line with a compact, eye-catching chart panel docked to the right side of the page, refreshed every second, plus estimated cost and DeepSeek account balance.

---

## 安装（开机自动加载，出现在插件列表）

本插件是**正式插件包**（不是一次性动态插件）：安装一次即出现在 DSH 的插件列表里，每次启动自动加载。

1. 找到你的 DSH profile（默认 `~/.dsh/profiles/<profile>/`，本仓库作者用的是 `web` profile）。
2. 编辑 `package.json`，把本插件加入 `dependencies` 与 `dsh.profile.bundles`：

```json
{
  "dependencies": {
    "dsh-better-status": "https://github.com/Yaing-Yan/dsh-better-status/archive/refs/tags/v1.0.0.tar.gz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-better-status"
      ]
    }
  }
}
```

3. 在该 profile 目录执行：

```bash
pnpm install
```

4. **重启 DSH**。打开任一有会话的界面，页面右侧即出现每秒刷新的图表，并在「设置 → 插件」里看到 `dsh-better-status`。

> 余额功能需要能读到你的 API Key：在 DSH 的 Models 设置页配置 `DEEPSEEK_API_KEY`（或 `llm-deepseek` 设置里的 `apiKeyEnv`）。未配置时余额显示「—」，其余图表不受影响。

## 效果

原来的统计是一行容易被忽略的小字，插件把它变成页面右侧的可折叠面板（右上角，`position: fixed`，不遮挡左侧会话与中央对话流），并**每秒刷新一次**：

| 指标 | 图表形式 |
| --- | --- |
| 轮 / 步 | 两个大数字卡片（蓝 / 紫） |
| 本次花费 / 账户余额 | 两个数字卡片（花费为估算，余额来自 DeepSeek `/user/balance`） |
| LLM 耗时 vs 工具耗时 | SVG 环形图（donut）＋ 图例 |
| 首 token 平均、生成速度 tok/s | 渐变进度条 |
| 缓存命中 | 环形进度环（ring gauge） |
| 输入 / 输出 token | 堆叠条形图 |
| 上下文占用（附加） | 环形进度环 |

## 特性

- **每秒自动刷新**：`timer` 服务驱动 1s tick，强制重渲染并重读最新投影。
- **零图表依赖**：全部用原生 `React.createElement` + 内联 SVG + CSS 绘制，无构建步骤（纯 JS）。
- **数据权威**：直接读取会话投影 `sessionStats` / `tokenUsage` / `contextPressure`（与官方统计行同源）。
- **花费与余额**：花费按 token 用量 × 单价估算；余额由 Host 侧通过 Typert Remote 调 DeepSeek `/user/balance` 读取（缓存 60s）。
- **自动降级**：`sessionStats` 投影缺失时回退到本地节点折叠（`deriveStats`）。
- **主题自适应**：颜色使用 `--dsw-*` 变量，明暗主题自动适配。

## 数据来源

插件注册在会话级 slot `conversation.composer.dock`（官方统计行所在的 seat，`id: stats` 替换官方文本行），拿到框架注入的标准 props：

- `useProjection('sessionStats')` → `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`
- `useProjection('tokenUsage')` → `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`
- `useProjection('contextPressure')` → `{ projectedTokens, pressureTokens, contextWindow }`
- `useSession(s => s.chat.legacy.nodes)` → 会话节点（降级折叠用）

各指标换算与官方统计行一致：

- 首 token 平均 = `ttftMs / ttftSteps`
- 生成速度 = `decodeTokens / (decodeMs / 1000)`
- 缓存命中 = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`
- 输入 token = `uncachedInputTokens + cacheReadTokens + cacheWriteTokens`
- **花费** = `(uncached + cacheWrite) × 输入单价 + cacheRead × 缓存命中单价 + output × 输出单价`（单价见 `lib/client.js` 顶部 `PRICING`，单位 USD/百万 token，可按你的模型修改）
- **余额** = Host 侧 `GET {baseURL}/user/balance` 的 `balance_infos[0].total_balance`（`baseURL`/`apiKeyEnv` 读自 `llm-deepseek` 设置，缺省 `https://api.deepseek.com` + `DEEPSEEK_API_KEY`）

## 仓库结构

```
dsh-better-status/
├── package.json        # dsh.client / dsh.bundle.patch / exports
├── dsh.plugin.json     # 插件列表元数据
├── cordis.patch.yml    # 插入到 host composition 的 patch
├── lib/
│   ├── index.js        # Host 侧：余额 Typert Remote（纯 ESM，无构建）
│   └── client.js       # Client 侧：图表面板（CJS + ModuleLoader 包装）
├── README.md
└── LICENSE
```

## 二次开发

- 改配色：改 `lib/client.js` 里的 `C` 调色板。
- 改面板位置/宽度：改 `lib/client.js` 的 `CSS` 里 `.bsb-panel` 的 `top / right / width`。
- 改花费单价：改 `lib/client.js` 顶部的 `PRICING`（USD/百万 token）。
- 改余额刷新间隔：Host 缓存 60s（`lib/index.js` 的 `60000`），Client 每 60 tick 拉一次（`lib/client.js` 的 `tick % 60`）。
- 图表都是无 hook 的纯展示函数（`Tile` / `Donut` / `Ring` / `Bar` / `StackedBar` / `LegendItem`），可任意复用。

## License

[MIT](LICENSE) © Yaing-Yan
