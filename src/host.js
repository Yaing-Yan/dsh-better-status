// dsh-better-status requires no Host half.
//
// Every metric is read client-side through the standard `useProjection`
// (`sessionStats`, `tokenUsage`, `contextPressure`) and `useSession` slot
// props that the DeepSeek Harness web shell already injects into
// session-scoped slots. Leave the `code.host` field empty when defining the
// plugin.
