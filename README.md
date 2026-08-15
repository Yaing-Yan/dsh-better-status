# dsh-better-status

> DeepSeek Harness 插件：把底部那行「1 轮 · 2 步 | LLM 1m38s · 工具调用 0.2s | 首 token 平均 42.4s · 8.2 tok/s | 缓存命中 0% | 输入 18.4K tok · 输出 109」文本统计，替换成页面右侧**直观、醒目**的图表面板。

A [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-OCR) dynamic Cordis plugin that replaces the plain-text session stats line with a compact, eye-catching chart panel docked to the right side of the page.

---

## 效果预览

原来的统计是一行容易被忽略的小字：

```
1 轮 · 2 步 | LLM 1m38s · 工具调用 0.2s | 首 token 平均 42.4s · 8.2 tok/s | 缓存命中 0% | 输入 18.4K tok · 输出 109
```

插件把它变成页面右侧的一个可折叠面板（右上角，`position: fixed`，不遮挡左侧会话与中央对话流）：

| 指标 | 图表形式 |
| --- | --- |
| 轮 / 步 | 两个大数字卡片（蓝 / 紫） |
| LLM 耗时 vs 工具耗时 | SVG 环形图（donut）＋ 图例 |
| 首 token 平均、生成速度 tok/s | 渐变进度条 |
| 缓存命中 | 环形进度环（ring gauge） |
| 输入 / 输出 token | 堆叠条形图 |
| 上下文占用（附加） | 环形进度环 |

面板右上角有折叠按钮，随时收起/展开；配色走 DSH 主题变量（`--dsw-*`），浅色 / 深色主题下都清晰可读。

## 特性

- **零依赖**：不引入任何图表库，全部用原生 `React.createElement` + 内联 SVG + CSS 绘制。
- **数据权威**：直接读取会话投影 `sessionStats` / `tokenUsage` / `contextPressure`（与官方统计行同源），无额外网络请求。
- **自动降级**：若 `sessionStats` 投影不存在，回退到对会话节点本地折叠（`deriveStats`），字段名与投影一一对应。
- **可折叠**：点击标题栏收起/展开，不影响主界面。
- **主题自适应**：颜色使用 `--dsw-*` 变量，明暗主题自动适配。
- **生命周期干净**：所有副作用（样式注入、slot 注册）都挂在 Cordis fiber 上，插件停止/更新即清理。

## 数据来源

插件注册在会话级 slot `conversation.composer.dock`（官方统计行所在的 seat），因此能拿到框架注入的标准 props：

- `useProjection('sessionStats')` → `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`
- `useProjection('tokenUsage')` → `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`
- `useProjection('contextPressure')` → `{ projectedTokens, pressureTokens, contextWindow }`
- `useSession(s => s.chat.legacy.nodes)` → 会话节点（降级折叠用）

各指标换算与官方统计行完全一致：

- 首 token 平均 = `ttftMs / ttftSteps`
- 生成速度 = `decodeTokens / (decodeMs / 1000)`
- 缓存命中 = `cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)`
- 输入 token = `uncachedInputTokens + cacheReadTokens + cacheWriteTokens`

## 使用方式

### 方式一：Web GUI 动态插件（推荐，最快）

1. 打开 DeepSeek Harness Web GUI。
2. 新建动态 Cordis 插件（`cordis_define`），其中：
   - `code.client` 填入 [`src/client.js`](src/client.js) 的函数体内容；
   - `code.host` 留空（本插件无需 Host 侧）。
3. 运行（`cordis_run`），并在 Run 卡片上点击一次勾选以授权该 Client 包。
4. 打开任一有会话的界面，右侧即出现图表。

### 方式二：作为源码阅读 / 二次开发

仓库结构：

```
dsh-better-status/
├── README.md
├── LICENSE
├── package.json
└── src/
    ├── client.js   # Client 侧插件代码（code.client 的函数体）
    └── host.js     # 无需 Host 侧（仅说明）
```

## 二次开发

- 想改配色：改 `src/client.js` 里的 `C` 调色板。
- 想改面板位置/宽度：改 `styles.insert(...)` 中 `.bsb-panel` 的 `top / right / width`。
- 想加新指标：在 `StatusPanel` 中再 `useProjection('<key>')`，然后加一个 section 即可。
- 每个图表都是无 hook 的纯展示函数（`Tile` / `Donut` / `Ring` / `Bar` / `StackedBar` / `LegendItem`），可任意复用。

## License

[MIT](LICENSE) © Yaing-Yan
