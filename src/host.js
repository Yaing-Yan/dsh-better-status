// dsh-better-status — Host half of the dynamic Cordis plugin.
//
// Paste everything below (the `return { ... }` function body) into the
// `code.host` field when defining the plugin in the DeepSeek Harness web GUI.
//
// The Host half fetches the DeepSeek account balance from `GET /user/balance`
// (authenticated with the resolved `DEEPSEEK_API_KEY`, or the `llm-deepseek`
// settings' `apiKeyEnv` / `baseURL`). It has no `fetch` global and the `web`
// service cannot send an Authorization header, so it shells out to `curl`.
// The result is cached for 60s and returned through the Package-private RPC
// method `getBalance`, which the Client half calls via `host.call`.

return {
  apply(ctx) {
    const credentials = ctx.get('credentials')
    const settings = ctx.get('settings')
    const shell = ctx.get('shell')

    let balanceCache = null
    let balanceAt = 0
    let balancePending = null

    async function fetchBalance() {
      if (credentials === undefined) return { ok: false, error: '缺少 credentials 服务' }
      if (shell === undefined) return { ok: false, error: '缺少 shell 服务' }
      let cfg
      try {
        cfg = settings !== undefined ? settings.get('llm-deepseek') : undefined
      } catch (e) {
        cfg = undefined
      }
      const ref = (cfg && cfg.apiKeyEnv) || 'DEEPSEEK_API_KEY'
      const baseURL = (cfg && cfg.baseURL) || 'https://api.deepseek.com'
      const hit = await credentials.resolve(ref)
      if (hit === undefined) return { ok: false, error: '未配置 API Key（' + ref + '）' }
      let spec
      try {
        spec = shell.resolve({
          command: 'curl -sS -H "Authorization: Bearer $DSH_BALANCE_KEY" "' + baseURL + '/user/balance"',
          env: { DSH_BALANCE_KEY: hit.value },
          timeoutMs: 15000,
          stdoutMaxBytes: 65536,
        })
      } catch (e) {
        return { ok: false, error: 'shell.resolve 失败: ' + String(e && e.message ? e.message : e) }
      }
      const result = await shell.run(spec)
      if (result.exitCode !== 0) return { ok: false, error: '余额请求失败（exit ' + result.exitCode + '）' }
      let data
      try {
        data = JSON.parse(result.stdout.text)
      } catch (e) {
        return { ok: false, error: '余额响应解析失败' }
      }
      const info = data && data.balance_infos && data.balance_infos[0]
      if (info === undefined) return { ok: false, error: '余额响应缺少 balance_infos' }
      return {
        ok: true,
        currency: info.currency,
        totalBalance: info.total_balance,
        grantedBalance: info.granted_balance,
        toppedUpBalance: info.topped_up_balance,
      }
    }

    harness.handle('getBalance', async () => {
      const now = Date.now()
      if (balanceCache !== null && now - balanceAt < 60000) return balanceCache
      if (balancePending !== null) return balancePending
      balancePending = fetchBalance().then((r) => {
        balanceCache = r
        balanceAt = Date.now()
        return r
      }).catch((e) => {
        return { ok: false, error: String(e && e.message ? e.message : e) }
      }).finally(() => {
        balancePending = null
      })
      return balancePending
    })
  },
}
