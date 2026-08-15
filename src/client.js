// dsh-better-status — Client half of the dynamic Cordis plugin.
//
// Paste everything below (the `return { ... }` function body) into the
// `code.client` field when defining the plugin in the DeepSeek Harness web
// GUI. Pair it with `src/host.js` in `code.host` (the Host half fetches the
// DeepSeek account balance through Package-private RPC `getBalance`).
//
// It replaces the shipped text stats line (slot `conversation.composer.dock`,
// id `stats`) with a fixed, right-side chart panel that refreshes once per
// second and shows turn/step counts, LLM/tool time, TTFT, throughput, cache
// hit, token usage, context occupancy, plus estimated cost and account balance.

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const timer = ctx.get('timer')

    // ---- formatting helpers (mirror shipped StatsLine) ----
    function formatDuration(ms) {
      const s = ms / 1e3
      if (s < 60) return `${Math.round(s * 10) / 10}s`
      const whole = Math.round(s)
      return `${Math.floor(whole / 60)}m${whole % 60}s`
    }
    function formatTokens(n) {
      const scaled = (v) => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10))
      if (n < 1e3) return String(n)
      if (n < 1e6) return `${scaled(n / 1e3)}K`
      return `${scaled(n / 1e6)}M`
    }
    function formatTps(tps) {
      const clamped = Math.max(0, tps)
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
    }
    function usageOutputTokens(usage) {
      if (typeof usage !== 'object' || usage === null) return null
      const value = usage.outputTokens
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    }
    function assistantStepReading(node) {
      const timing = node.timing
      return {
        ttftMs: timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
        decodeMs: timing !== undefined && timing.firstTokenTime !== null ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
        outputTokens: usageOutputTokens(node.usage),
      }
    }
    function deriveStats(nodes) {
      const turns = new Set()
      let steps = 0
      let llmMs = 0
      let toolMs = 0
      let ttftMs = 0
      let ttftSteps = 0
      let decodeMs = 0
      let decodeTokens = 0
      const list = nodes || []
      for (const node of list) {
        if (node.kind === 'tool-result') {
          if (node.callTime != null) toolMs += Math.max(0, node.time - node.callTime)
          continue
        }
        if (node.kind !== 'assistant') continue
        turns.add(node.turn)
        steps += 1
        if (node.timing !== undefined && node.timing.stepStartTime !== null) llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
        const reading = assistantStepReading(node)
        if (reading.ttftMs !== null) { ttftMs += reading.ttftMs; ttftSteps += 1 }
        if (reading.decodeMs !== null && reading.outputTokens !== null) { decodeMs += reading.decodeMs; decodeTokens += reading.outputTokens }
      }
      return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
    }
    function billedInput(usage) {
      return (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
    }
    function cacheHitPct(usage) {
      const d = billedInput(usage)
      return d === 0 ? null : Math.round(usage.cacheReadTokens / d * 100)
    }
    function contextOccupancy(pressure) {
      if (pressure == null) return null
      const used = pressure.projectedTokens ?? pressure.pressureTokens
      if (used === undefined || pressure.contextWindow === undefined) return null
      return { percent: Math.min(100, Math.round(used / pressure.contextWindow * 100)), used, window: pressure.contextWindow }
    }

    // ---- palette ----
    const C = {
      blue: '#4f7cff',
      purple: '#a78bfa',
      green: '#22c55e',
      amber: '#f59e0b',
      teal: '#14b8a6',
      sky: '#38bdf8',
      pink: '#f472b6',
    }

    // ---- pricing (USD per 1M tokens) — 按你的模型单价修改 ----
    const PRICING = {
      inputUsdPerM: 0.27,
      cacheHitUsdPerM: 0.07,
      outputUsdPerM: 1.10,
    }
    function costUsd(usage) {
      const uncached = usage.uncachedInputTokens || 0
      const cacheRead = usage.cacheReadTokens || 0
      const cacheWrite = usage.cacheWriteTokens || 0
      const output = usage.outputTokens || 0
      return (uncached + cacheWrite) / 1e6 * PRICING.inputUsdPerM
        + cacheRead / 1e6 * PRICING.cacheHitUsdPerM
        + output / 1e6 * PRICING.outputUsdPerM
    }
    function formatUsd(v) {
      if (v == null || !(v > 0)) return '$0.00'
      if (v < 0.01) return '$' + v.toFixed(4)
      return '$' + v.toFixed(2)
    }
    function formatBalance(b) {
      if (b == null) return '…'
      if (b.ok !== true) return '—'
      const sym = b.currency === 'CNY' ? '¥' : b.currency === 'USD' ? '$' : (b.currency ? b.currency + ' ' : '')
      return sym + b.totalBalance
    }

    // ---- package styles ----
    styles.insert(`.bsb-panel{position:fixed;top:64px;right:16px;width:300px;z-index:1000;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:14px;box-shadow:var(--dsw-shadow-lv3,0 8px 30px rgba(0,0,0,.16));overflow:hidden;font-family:var(--dsw-font-family,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif)}
.bsb-header{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:10px 14px;background:transparent;border:none;cursor:pointer;color:inherit;font:inherit;text-align:left}
.bsb-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.bsb-title{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;line-height:18px}
.bsb-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22c55e);flex:none;animation:bsb-pulse 2s ease-in-out infinite}
@keyframes bsb-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.bsb-chevron{color:var(--dsw-alias-label-tertiary,#888);font-size:12px;line-height:1}
.bsb-body{display:flex;flex-direction:column;gap:14px;padding:2px 14px 14px;max-height:calc(100vh - 140px);overflow-y:auto}
.bsb-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bsb-tile{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02))}
.bsb-tile-num{font-size:20px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.bsb-tile-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);line-height:16px}
.bsb-section{display:flex;flex-direction:column;gap:8px}
.bsb-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary,#888);line-height:16px}
.bsb-donut-row{display:flex;align-items:center;gap:16px}
.bsb-donut{position:relative;flex:none}
.bsb-donut-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.bsb-donut-num{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.bsb-donut-sub{font-size:10px;color:var(--dsw-alias-label-tertiary,#888)}
.bsb-legend{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}
.bsb-legend-item{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px}
.bsb-legend-dot{width:8px;height:8px;border-radius:50%;flex:none}
.bsb-legend-name{color:var(--dsw-alias-label-secondary,#555);flex:1;min-width:0}
.bsb-legend-val{color:var(--dsw-alias-label-primary,#111);font-weight:600;font-variant-numeric:tabular-nums}
.bsb-bar-item{display:flex;flex-direction:column;gap:5px}
.bsb-bar-top{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;line-height:18px}
.bsb-bar-name{color:var(--dsw-alias-label-secondary,#555)}
.bsb-bar-val{color:var(--dsw-alias-label-primary,#111);font-weight:600;font-variant-numeric:tabular-nums}
.bsb-track{height:8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));overflow:hidden}
.bsb-fill{height:100%;border-radius:999px;transition:width .4s ease}
.bsb-stacked{display:flex;height:16px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.bsb-seg{height:100%;min-width:2px;transition:width .4s ease}
.bsb-ring-row{display:flex;align-items:center;gap:16px}
.bsb-ring{position:relative;flex:none}
.bsb-ring-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.bsb-ring-side{display:flex;flex-direction:column;gap:2px}
.bsb-ring-side-label{font-size:12px;color:var(--dsw-alias-label-secondary,#555);line-height:18px}
.bsb-ring-side-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);line-height:16px}`)

    // ---- tiny presentational components (no hooks) ----
    function Tile(props) {
      return React.createElement('div', { className: 'bsb-tile' },
        React.createElement('div', { className: 'bsb-tile-num', style: { color: props.color } }, String(props.num)),
        React.createElement('div', { className: 'bsb-tile-label' }, props.label),
      )
    }
    function LegendItem(props) {
      return React.createElement('div', { className: 'bsb-legend-item' },
        React.createElement('span', { className: 'bsb-legend-dot', style: { background: props.color } }),
        React.createElement('span', { className: 'bsb-legend-name' }, props.name),
        React.createElement('span', { className: 'bsb-legend-val' }, props.value),
      )
    }
    function Bar(props) {
      const frac = props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0
      return React.createElement('div', { className: 'bsb-bar-item' },
        React.createElement('div', { className: 'bsb-bar-top' },
          React.createElement('span', { className: 'bsb-bar-name' }, props.name),
          React.createElement('span', { className: 'bsb-bar-val' }, props.display),
        ),
        React.createElement('div', { className: 'bsb-track' },
          React.createElement('div', { className: 'bsb-fill', style: { width: (frac * 100) + '%', background: props.color } }),
        ),
      )
    }
    function StackedBar(props) {
      const segs = props.segments.filter((s) => s.value > 0)
      const total = segs.reduce((s, x) => s + x.value, 0)
      return React.createElement('div', { className: 'bsb-stacked' },
        total > 0 ? segs.map((seg, i) => React.createElement('div', {
          key: i, className: 'bsb-seg', style: { width: (seg.value / total * 100) + '%', background: seg.color },
        })) : null,
      )
    }
    function Donut(props) {
      const size = props.size || 92
      const stroke = props.stroke || 12
      const r = (size - stroke) / 2
      const c = 2 * Math.PI * r
      const center = size / 2
      const total = props.segments.reduce((s, x) => s + x.value, 0)
      const circles = []
      if (total <= 0) {
        circles.push(React.createElement('circle', { key: 'empty', cx: center, cy: center, r, fill: 'none', stroke: 'var(--dsw-alias-border-l2,rgba(0,0,0,.12))', strokeWidth: stroke }))
      } else {
        let acc = 0
        props.segments.forEach((seg, i) => {
          const len = (seg.value / total) * c
          circles.push(React.createElement('circle', {
            key: i, cx: center, cy: center, r, fill: 'none', stroke: seg.color, strokeWidth: stroke,
            strokeLinecap: 'butt',
            strokeDasharray: `${len} ${c - len}`,
            strokeDashoffset: -acc,
            transform: `rotate(-90 ${center} ${center})`,
          }))
          acc += len
        })
      }
      return React.createElement('div', { className: 'bsb-donut', style: { width: size + 'px', height: size + 'px' } },
        React.createElement('svg', { width: size, height: size, style: { display: 'block' } }, circles),
        React.createElement('div', { className: 'bsb-donut-label' }, props.children),
      )
    }
    function Ring(props) {
      const size = props.size || 72
      const stroke = props.stroke || 8
      const r = (size - stroke) / 2
      const c = 2 * Math.PI * r
      const center = size / 2
      const frac = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0
      return React.createElement('div', { className: 'bsb-ring', style: { width: size + 'px', height: size + 'px' } },
        React.createElement('svg', { width: size, height: size, style: { display: 'block' } },
          React.createElement('circle', { cx: center, cy: center, r, fill: 'none', stroke: 'var(--dsw-alias-border-l2,rgba(0,0,0,.12))', strokeWidth: stroke }),
          React.createElement('circle', {
            cx: center, cy: center, r, fill: 'none', stroke: props.color, strokeWidth: stroke,
            strokeLinecap: 'round',
            strokeDasharray: c,
            strokeDashoffset: c * (1 - frac),
            transform: `rotate(-90 ${center} ${center})`,
            style: { transition: 'stroke-dashoffset .4s ease, stroke .4s ease' },
          }),
        ),
        React.createElement('div', { className: 'bsb-ring-label' }, props.children),
      )
    }

    // ---- the status panel (registered in place of the shipped text stats line) ----
    function StatusPanel(props) {
      const useProjection = props.useProjection
      const useSession = props.useSession
      const [open, setOpen] = React.useState(true)
      const [tick, setTick] = React.useState(0)
      const [balance, setBalance] = React.useState(null)
      React.useEffect(() => {
        if (timer === undefined) return undefined
        return timer.interval(() => setTick((t) => t + 1), 1000)
      }, [])
      React.useEffect(() => {
        if (tick % 60 !== 0) return undefined
        if (typeof host === 'undefined' || typeof host.call !== 'function') return undefined
        let alive = true
        host.call('getBalance', {}).then((r) => {
          if (alive) setBalance(r)
        }).catch((e) => {
          if (alive) setBalance({ ok: false, error: String(e && e.message ? e.message : e) })
        })
        return () => { alive = false }
      }, [tick])
      void tick

      const settledNodes = typeof useSession === 'function' ? useSession((s) => s.chat.legacy.nodes) : undefined
      const usage = typeof useProjection === 'function' ? useProjection('tokenUsage') : undefined
      const projected = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
      const pressure = typeof useProjection === 'function' ? useProjection('contextPressure') : undefined

      const stats = projected ?? deriveStats(settledNodes)
      const turns = stats.turns || 0
      const steps = stats.steps || 0
      const llmMs = stats.llmMs || 0
      const toolMs = stats.toolMs || 0
      const ttftAvg = stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
      const tps = stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1000) : null

      let inputTokens = 0
      let outputTokens = 0
      let cacheHit = null
      if (usage != null) {
        inputTokens = billedInput(usage)
        outputTokens = usage.outputTokens || 0
        cacheHit = cacheHitPct(usage)
      }
      const spend = usage != null ? costUsd(usage) : 0
      const occ = contextOccupancy(pressure)

      const hasData = steps > 0 || inputTokens > 0 || outputTokens > 0
      if (!hasData) return null

      return React.createElement('div', { className: 'bsb-panel' },
        React.createElement('button', { className: 'bsb-header', onClick: () => setOpen((v) => !v), 'aria-expanded': open },
          React.createElement('span', { className: 'bsb-title' },
            React.createElement('span', { className: 'bsb-dot' }),
            '运行状态',
          ),
          React.createElement('span', { className: 'bsb-chevron' }, open ? '▾' : '▸'),
        ),
        open ? React.createElement('div', { className: 'bsb-body' },
          React.createElement('div', { className: 'bsb-tiles' },
            Tile({ num: turns, label: '轮', color: C.blue }),
            Tile({ num: steps, label: '步', color: C.purple }),
          ),
          React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, '花费 / 余额'),
            React.createElement('div', { className: 'bsb-tiles' },
              Tile({ num: '≈' + formatUsd(spend), label: '本次花费', color: C.amber }),
              Tile({ num: formatBalance(balance), label: '账户余额', color: C.green }),
            ),
          ),
          (llmMs > 0 || toolMs > 0) ? React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, '耗时分布'),
            React.createElement('div', { className: 'bsb-donut-row' },
              Donut({ size: 92, stroke: 12, segments: [
                { value: llmMs, color: C.blue },
                { value: toolMs, color: C.purple },
              ], children: [
                React.createElement('div', { key: 'n', className: 'bsb-donut-num' }, formatDuration(llmMs + toolMs)),
                React.createElement('div', { key: 's', className: 'bsb-donut-sub' }, '总耗时'),
              ] }),
              React.createElement('div', { className: 'bsb-legend' },
                LegendItem({ color: C.blue, name: '模型', value: formatDuration(llmMs) }),
                LegendItem({ color: C.purple, name: '工具', value: formatDuration(toolMs) }),
              ),
            ),
          ) : null,
          (ttftAvg !== null || tps !== null) ? React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, '速度'),
            ttftAvg !== null ? Bar({ name: '首 token', value: ttftAvg, max: 60000, color: C.amber, display: formatDuration(ttftAvg) }) : null,
            tps !== null ? Bar({ name: '生成速度', value: tps, max: 30, color: C.teal, display: formatTps(tps) + ' tok/s' }) : null,
          ) : null,
          cacheHit !== null ? React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, '缓存命中'),
            React.createElement('div', { className: 'bsb-ring-row' },
              Ring({ value: cacheHit, max: 100, color: C.green, size: 72, stroke: 8, children: cacheHit + '%' }),
              React.createElement('div', { className: 'bsb-ring-side' },
                React.createElement('div', { className: 'bsb-ring-side-label' }, 'Cache hit'),
                React.createElement('div', { className: 'bsb-ring-side-sub' }, '提示词侧缓存命中占比'),
              ),
            ),
          ) : null,
          (inputTokens > 0 || outputTokens > 0) ? React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, 'Token 用量'),
            StackedBar({ segments: [
              { value: inputTokens, color: C.sky },
              { value: outputTokens, color: C.pink },
            ] }),
            React.createElement('div', { className: 'bsb-legend' },
              LegendItem({ color: C.sky, name: '输入', value: formatTokens(inputTokens) }),
              LegendItem({ color: C.pink, name: '输出', value: formatTokens(outputTokens) }),
            ),
          ) : null,
          occ !== null ? React.createElement('div', { className: 'bsb-section' },
            React.createElement('div', { className: 'bsb-section-title' }, '上下文占用'),
            React.createElement('div', { className: 'bsb-ring-row' },
              Ring({ value: occ.percent, max: 100, color: C.blue, size: 72, stroke: 8, children: occ.percent + '%' }),
              React.createElement('div', { className: 'bsb-ring-side' },
                React.createElement('div', { className: 'bsb-ring-side-label' }, formatTokens(occ.used) + ' / ' + formatTokens(occ.window) + ' tok'),
                React.createElement('div', { className: 'bsb-ring-side-sub' }, '上下文窗口占用'),
              ),
            ),
          ) : null,
        ) : null,
      )
    }

    slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'stats', order: 0 },
      StatusPanel,
    ))
  },
}
