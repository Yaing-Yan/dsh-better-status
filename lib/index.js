/**
 * dsh-better-status — Host half.
 *
 * Fetches the DeepSeek account balance from `GET {baseURL}/user/balance`
 * (authenticated with the resolved API key) and exposes it to the browser
 * half through a Typert Remote (`balance/getBalance`). The host has no
 * `fetch` global and the `web` service cannot send an Authorization header,
 * so the request shells out to `curl` with the key carried on the child
 * process environment (never in argv). The result is cached for 60s.
 *
 * This file is plain ESM and needs no build step. The Loader resolves it as
 * the plugin's entry because `main` points here.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-better-status'

/** Services required before load: the Typert registry only. */
export const inject = ['typert']

/** Wire descriptor for the single `balance/getBalance` remote method. */
const GET_BALANCE = {
  id: 'dsh-better-status#balance/getBalance',
  service: 'balance',
  namespace: 'balance',
  method: 'getBalance',
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
        description: 'DeepSeek account balance reader for the status panel.',
        tags: [],
        members: [
          { kind: 'method', name: 'getBalance', signature: 'getBalance(): Promise<Balance>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: [GET_BALANCE],
}

/** Cordis service exposing the (cached) balance fetch over Typert. */
class BalanceService extends TypertRemoteService {
  constructor(ctx, getBalance) {
    super(ctx, 'balance')
    this.getBalanceImpl = getBalance
  }

  getBalance() {
    return this.getBalanceImpl()
  }
}

export function apply(ctx) {
  const credentials = ctx.get('credentials')
  const settings = ctx.get('settings')
  const shell = ctx.get('shell')

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

  // Register the service (provides `ctx.balance`) and claim the wire endpoints.
  new BalanceService(ctx, getBalanceCached)
  ctx.effect(() => ctx.typert.register(MANIFEST), 'dsh-better-status: typert manifest')
}
