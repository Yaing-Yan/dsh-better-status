/**
 * dsh-better-status — Host half.
 *
 * Exposes two Typert Remote methods to the browser half:
 *   - `balance/getBalance` — DeepSeek account balance from
 *     `GET {baseURL}/user/balance` (authenticated via the resolved API key).
 *     The host has no `fetch` global and the `web` service cannot send an
 *     Authorization header, so it shells out to `curl` with the key carried
 *     on the child process environment (never in argv). Cached for 60s.
 *   - `balance/getPricing` — the per-model token pricing (USD / 1M tokens)
 *     selected from the currently active model.
 *
 * DeepSeek's API does NOT disclose pricing (neither `/models` nor the
 * completion `usage` carries it), so the unit prices below are a per-model
 * table that the plugin selects from automatically; keep the table updated to
 * your provider's real rates.
 *
 * This file is plain ESM and needs no build step. The Loader resolves it as
 * the plugin's entry because `main` points here.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-better-status'

/** Services required before load: the Typert registry only. */
export const inject = ['typert']

/**
 * Per-model token pricing in USD per 1M tokens.
 * Keyed by the provider-owned model id; the active model's entry is chosen at
 * call time, and DEFAULT_PRICING covers unknown ids. Update these to your
 * provider's published rates.
 */
const MODEL_PRICING = {
  'deepseek-chat': { inputUsdPerM: 0.27, cacheHitUsdPerM: 0.07, outputUsdPerM: 1.10 },
  'deepseek-reasoner': { inputUsdPerM: 0.55, cacheHitUsdPerM: 0.14, outputUsdPerM: 2.19 },
  'deepseek-v4-flash': { inputUsdPerM: 0.27, cacheHitUsdPerM: 0.07, outputUsdPerM: 1.10 },
  'deepseek-v4-pro': { inputUsdPerM: 0.55, cacheHitUsdPerM: 0.14, outputUsdPerM: 2.19 },
}
const DEFAULT_PRICING = { inputUsdPerM: 0.27, cacheHitUsdPerM: 0.07, outputUsdPerM: 1.10 }

/** Wire descriptor for `balance/getBalance`. */
const GET_BALANCE = {
  id: 'dsh-better-status#balance/getBalance',
  service: 'balance',
  namespace: 'balance',
  method: 'getBalance',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
}

/** Wire descriptor for `balance/getPricing`. */
const GET_PRICING = {
  id: 'dsh-better-status#balance/getPricing',
  service: 'balance',
  namespace: 'balance',
  method: 'getPricing',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
}

/** Strict host manifest registered through `ctx.typert.register`. */
const MANIFEST = {
  package: 'dsh-better-status',
  face: 'host',
  schemas: [],
  model: {
    services: [
      {
        key: 'balance',
        exportName: 'BalanceService',
        description: 'DeepSeek account balance and per-model pricing for the status panel.',
        tags: [],
        members: [
          { kind: 'method', name: 'getBalance', signature: 'getBalance(): Promise<Balance>' },
          { kind: 'method', name: 'getPricing', signature: 'getPricing(): Pricing' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: [GET_BALANCE, GET_PRICING],
}

/** Cordis service exposing the (cached) balance fetch over Typert. */
class BalanceService extends TypertRemoteService {
  constructor(ctx, getBalance, getPricing) {
    super(ctx, 'balance')
    this.getBalanceImpl = getBalance
    this.getPricingImpl = getPricing
  }

  getBalance() {
    return this.getBalanceImpl()
  }

  getPricing() {
    return this.getPricingImpl()
  }
}

export function apply(ctx) {
  const credentials = ctx.get('credentials')
  const settings = ctx.get('settings')
  const shell = ctx.get('shell')
  const agentDefaultModel = ctx.get('agentDefaultModel')

  let balanceCache = null
  let balanceAt = 0
  let balancePending = null

  async function fetchBalance() {
    if (credentials === undefined) throw new Error('缺少 credentials 服务')
    if (shell === undefined) throw new Error('缺少 shell 服务')

    let cfg
    try {
      cfg = settings !== undefined ? settings.get('llm-deepseek') : undefined
    } catch (e) {
      cfg = undefined
    }
    const ref = (cfg && cfg.apiKeyEnv) || 'DEEPSEEK_API_KEY'
    const baseURL = (cfg && cfg.baseURL) || 'https://api.deepseek.com'

    const hit = await credentials.resolve(ref)
    if (hit === undefined) throw new Error('未配置 API Key（' + ref + '）')

    let spec
    try {
      spec = shell.resolve({
        command: 'curl -sS -H "Authorization: Bearer $DSH_BALANCE_KEY" "' + baseURL + '/user/balance"',
        env: { DSH_BALANCE_KEY: hit.value },
        timeoutMs: 15000,
        stdoutMaxBytes: 65536,
      })
    } catch (e) {
      throw new Error('shell.resolve 失败: ' + String(e && e.message ? e.message : e))
    }

    const result = await shell.run(spec)
    if (result.exitCode !== 0) throw new Error('余额请求失败（exit ' + result.exitCode + '）')

    let data
    try {
      data = JSON.parse(result.stdout.text)
    } catch (e) {
      throw new Error('余额响应解析失败')
    }

    const info = data && data.balance_infos && data.balance_infos[0]
    if (info === undefined) throw new Error('余额响应缺少 balance_infos')

    return {
      currency: info.currency,
      totalBalance: info.total_balance,
      grantedBalance: info.granted_balance,
      toppedUpBalance: info.topped_up_balance,
    }
  }

  async function getBalanceCached() {
    const now = Date.now()
    if (balanceCache !== null && now - balanceAt < 60000) return balanceCache
    if (balancePending !== null) return balancePending
    balancePending = fetchBalance()
      .then((r) => {
        balanceCache = r
        balanceAt = Date.now()
        return r
      })
      .finally(() => {
        balancePending = null
      })
    return balancePending
  }

  function getPricing() {
    let modelId = ''
    try {
      const selection = agentDefaultModel !== undefined ? agentDefaultModel.currentSelection() : undefined
      modelId = selection && selection.model ? selection.model : ''
    } catch (e) {
      modelId = ''
    }
    const pricing = MODEL_PRICING[modelId] || DEFAULT_PRICING
    return {
      modelId,
      inputUsdPerM: pricing.inputUsdPerM,
      cacheHitUsdPerM: pricing.cacheHitUsdPerM,
      outputUsdPerM: pricing.outputUsdPerM,
    }
  }

  // Register the service (provides `ctx.balance`) and claim the wire endpoints.
  new BalanceService(ctx, getBalanceCached, getPricing)
  ctx.effect(() => ctx.typert.register(MANIFEST), 'dsh-better-status: typert manifest')
}
