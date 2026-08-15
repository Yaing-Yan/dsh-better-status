# dsh-better-status

> DeepSeek Harness 插件：把底部那行「1 轮 · 2 步 | LLM 1m38s · 工具调用 0.2s | 首 token 平均 42.4s · 8.2 tok/s | 缓存命中 0% | 输入 18.4K tok · 输出 109」文本统计，替换成页面右侧**直观、醒目**、**每秒自动刷新**的图表面板，并额外显示**本次花费**与 **DeepSeek 账户余额**。

A [DeepSeek Harness](https://github.com/deepseek-ai) dynamic Cordis plugin that replaces the plain-text session stats line with a compact, eye-catching chart panel docked to the right side of the page, refreshed every second, plus estimated cost and DeepSeek account balance.

---

## 效果预览

原来的统计是一行容易被忽略的小字：

```
1 轮 · 2 步 | LLM 1m38s · 工具调用 0.2s | 首 token 平均 42.4s · 8.2 tok/s | 缓存命中 0% | 输入 18.4K tok · 输出 109
```

插件把它变成页面右侧的一个可折叠面板（右上角，`position: fixed`，不遮挡左侧会话与中央对话流），并**每秒刷新一次**：

| 指标 | 图表形式 |
| --- | --- |
| 轮 / 步 | 两个大数字卡片（蓝 / 紫） |
| 本次花费 / 账户余额 | 两个数字卡片（花费为估算，余额来自 DeepSeek `/user/balance`） |
| LLM 耗时 vs 工具耗时 | SVG 环形图（donut）＋ 图例 |
| 首 token 平均、生成速度 tok/s | 渐变进度条 |
| 缓存命中 | 环形进度环（ring gauge） |
| 输入 / 输出 token | 堆叠条形图 |
| 上下文占用（附加） | 环形进度环 |

面板右上角有折叠按钮，随时收起/展开；配色走 DSH 主题变量（`--dsw-*`），浅色 / 深色主题下都清晰可读。

## 特性

- **每秒自动刷新**：`timer` 服务驱动 1s tick，强制重渲染并重读最新投影。
- **零图表依赖**：全部用原生 `React.createElement` + 内联 SVG + CSS 绘制。
- **数据权威**：直接读取会话投影 `sessionStats` / `tokenUsage` / `contextPressure`（与官方统计行同源）。
- **花费与余额**：花费按 token 用量 × 单价估算；余额通过 Host 侧调用 DeepSeek `/user/balance` 读取（缓存 60s）。
- **自动降级**：`sessionStats` 投影缺失时回退到本地节点折叠（`deriveStats`）。
- **可折叠、主题自适应**：折叠按钮 + `--dsw-*` 主题变量。
- **生命周期干净**：样式注入、slot 注册、RPC handler、timer 都挂在 Cordis fiber / React 生命周期上。

## 数据来源

插件注册在会话级 slot `conversation.composer.dock`（官方统计行所在的 seat），拿到框架注入的标准 props：

- `useProjection('sessionStats')` → `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`
- `useProjection('tokenUsage')` → `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`
- `useProjection('contextPressure')` → `{ projectedTokens, pressureTokens, contextWindow }`
- `useSession(s => s.chat.legacy.nodes)` → 会话节点（降级折叠用）

各指标换算与官方统计行一致：

- 首 token 平均 = `ttftMs / ttftSteps`
- 生成速度 = `decodeTokens / (decodeMs / 1000)`
- 缓存命中 = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`
- 输入 token = `uncachedInputTokens + cacheReadTokens + cacheWriteTokens`
- **花费** = `(uncached + cacheWrite) × 输入单价 + cacheRead × 缓存命中单价 + output × 输出单价`（单价见 `src/client.js` 顶部 `PRICING`，单位 USD/百万 token，可按你的模型修改）
- **余额** = Host 侧 `GET {baseURL}/user/balance` 的 `balance_infos[0].total_balance`（`baseURL`/`apiKeyEnv` 读自 `llm-deepseek` 设置，缺省 `https://api.deepseek.com` + `DEEPSEEK_API_KEY`）

## 使用方式

### 方式一：Web GUI 动态插件（推荐）

1. 打开 DeepSeek Harness Web GUI。
2. 新建动态 Cordis 插件（`cordis_define`）：
   - `code.host` 填入 [`src/host.js`](src/host.js) 的函数体（负责调余额接口）；
   - `code.client` 填入 [`src/client.js`](src/client.js) 的函数体（负责渲染图表）。
3. 运行（`cordis_run`），并在 Run 卡片上点击勾选授权该 Client 包。
4. 打开任一有会话的界面，右侧即出现每秒刷新的图表。

> 余额功能需要能读到你的 API Key：在 DSH 的 Models 设置页配置 `DEEPSEEK_API_KEY`（或 `llm-deepseek` 设置中的 `apiKeyEnv`）。未配置时面板只显示「—」，不影响其余图表。

### 方式二：源码阅读 / 二次开发

仓库结构：

```
dsh-better-status/
├── README.md
├── LICENSE
├── package.json
└── src/
    ├── client.js   # Client 侧插件代码（code.client 的函数体）
    └── host.js     # Host 侧插件代码（code.host 的函数体，负责余额接口）
```

## 二次开发

- 改配色：改 `src/client.js` 里的 `C` 调色板。
- 改面板位置/宽度：改 `styles.insert(...)` 中 `.bsb-panel` 的 `top / right / width`。
- 改花费单价：改 `src/client.js` 顶部的 `PRICING`（USD/百万 token）。
- 改余额刷新间隔：Host 缓存 60s（`src/host.js` 的 `60000`），Client 每 60 tick 拉一次（`src/client.js` 的 `tick % 60`）。
- 加新指标：在 `StatusPanel` 中再 `useProjection('<key>')`，加一个 section 即可。
- 图表都是无 hook 的纯展示函数（`Tile` / `Donut` / `Ring` / `Bar` / `StackedBar` / `LegendItem`），可任意复用。

## License

[MIT](LICENSE) © Yaing-Yan
