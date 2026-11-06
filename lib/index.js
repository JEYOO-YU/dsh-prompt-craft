/**
 * Host half of dsh-prompt-craft.
 *
 * One job: POST /prompt-craft/enhance {text, sessionId?} → one LLM call with
 * the craft system prompt → {ok, text, elapsedMs}. No session events, no
 * commands, no settings surface: the original dsh-prompt-enhance keeps all of
 * that, and this plugin is deliberately a small, self-contained second opinion
 * that can be uninstalled without touching it.
 *
 * @module dsh-prompt-craft
 */

const ROUTE_PREFIX = '/prompt-craft'
const ENHANCE_PATH = '/prompt-craft/enhance'
const MAX_INPUT_CHARS = 12000
const MAX_BODY_BYTES = 256 * 1024

/** Defaults; every one of them can be overridden by the patch `config:`. */
const DEFAULTS = {
  provider: '',
  model: '',
  temperature: 0.3,
  maxOutputTokens: 4096,
  timeoutMs: 60000,
  /**
   * 'off' measured 2.6–3.2s on deepseek-flash, against 8–12s for 'low' and
   * 9–15s for 'inherit': a composer button must feel immediate, so speed is the
   * default and the per-request body can still ask for more effort.
   * 'inherit' omits the field so the model's own default effort applies.
   */
  reasoningEffort: 'off',
  /** Non-empty replaces the built-in craft prompt (advanced; leave empty). */
  systemPrompt: '',
}

/**
 * The craft prompt: write a task brief for a tool-using agent, not a chat
 * prompt. See README "为什么这样写" for the rationale.
 */
const CRAFT_SYSTEM_PROMPT = `You rewrite a user's rough task description into a task brief. The reader is not a chat model: it is an autonomous agent with file, shell, search, web and subagent tools, its own system prompt, its own planner and its own approval rules. It will act on your text over many turns, usually without the user watching. Your text is the last thing the user checks before pressing send.

Supply the decisions the agent cannot recover on its own — do not describe how it should work.

Make the brief state, in whatever shape fits the task:
- the outcome wanted, and what it is for (the purpose is what lets the agent resolve the cases you did not foresee);
- boundaries that are not obvious: what must not change, what is out of scope, what is irreversible and must be confirmed first;
- what done looks like in a checkable form: an observable end state, a command, a file, a diff, a number; if the task cannot be checked, say what evidence would settle it;
- where the ground truth lives: paths, commands, URLs, exact error text, versions — things the agent should read instead of guessing.

Never write: a persona or seniority for the agent to adopt; a numbered procedure it can plan itself; a section the task does not need; boilerplate about being careful, thorough or professional; placeholders such as TBD, TODO or 待补充.

Uncertainty: never leave a hole and never invent. Resolve it the way a competent colleague would — take the most probable reading, state it in one short line inside the brief ("Assuming X; if it is actually Y, do Z instead", translated to the input's language), and prefer the reading that is cheapest to undo. Put a question to the user only when two readings lead to materially different, hard-to-reverse work; even then, one line starting "先确认：" with at most two short questions is enough.

Decide what the user would want decided: scope edges, the definition of done, what to do when blocked, which of two readings is meant. Do not decide what is theirs: product or design choices, which tradeoff they prefer, which of their goals matters most, anything only they can know — name it as something the agent must settle with them before acting.

Keep every constraint and fact the user gave, in their own words where the wording carries the intent (names, paths, numbers, quoted limits). Add nothing they did not imply or would not accept. Do not soften, widen or redirect the task.

Length follows information, not a ratio. A six-word request may need ten times its length to become actionable; an already-specific brief may need to get shorter. Never pad, and never drop a needed constraint to stay short.

Output only the brief — no preamble, no "here is", no account of what you changed, and no code fence wrapped around the whole thing. Match the language of the input.`

/**
 * Read one config value with a type-and-range guard.
 * @param value - raw value from the patch document.
 * @param fallback - value used when the raw one is unusable.
 * @returns the usable value.
 */
function pick(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value
}

/**
 * Normalize the patch `config:` block into the shape serve() reads.
 * @param config - raw plugin config from the loader.
 * @returns the normalized config.
 */
function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const effort = EFFORTS.includes(raw.reasoningEffort) ? raw.reasoningEffort : DEFAULTS.reasoningEffort
  return {
    provider: String(pick(raw.provider, DEFAULTS.provider)).trim(),
    model: String(pick(raw.model, DEFAULTS.model)).trim(),
    temperature: Number.isFinite(raw.temperature) ? Math.min(2, Math.max(0, raw.temperature)) : DEFAULTS.temperature,
    maxOutputTokens: Number.isInteger(raw.maxOutputTokens) && raw.maxOutputTokens > 0
      ? Math.min(32000, raw.maxOutputTokens)
      : DEFAULTS.maxOutputTokens,
    timeoutMs: Number.isInteger(raw.timeoutMs) && raw.timeoutMs > 1000
      ? Math.min(300000, raw.timeoutMs)
      : DEFAULTS.timeoutMs,
    reasoningEffort: effort,
    systemPrompt: typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim() !== ''
      ? raw.systemPrompt.trim()
      : CRAFT_SYSTEM_PROMPT,
  }
}

/**
 * Read a request body with a hard byte cap.
 * @param req - the incoming request.
 * @returns the decoded UTF-8 body.
 * @throws Error with `code = 'too-large'` past the cap.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.code = 'too-large'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Write one JSON response.
 * @param res - the server response.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function json(res, status, payload) {
  if (res.headersSent) return
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Resolve the provider/model pair for the call.
 *
 * Precedence: explicit patch config, then the harness default-model selection.
 * Nothing is guessed: with no route the request fails with a readable message
 * instead of silently borrowing a model the user did not pick.
 * @param ctx - host context.
 * @param cfg - normalized config.
 * @returns the route, or undefined when no source names one.
 */
function resolveRoute(ctx, cfg) {
  if (cfg.provider !== '' && cfg.model !== '') return { provider: cfg.provider, model: cfg.model }
  try {
    const face = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
    const selection = face !== undefined && typeof face.currentSelection === 'function' ? face.currentSelection() : undefined
    if (selection !== undefined && selection !== null && selection.provider && selection.model) {
      return { provider: String(selection.provider), model: String(selection.model) }
    }
  } catch {
    // A missing or relocated service must not break the route: fall through.
  }
  return undefined
}

/**
 * Strip a fence wrapping the whole answer, then trim.
 * The prompt forbids it, but a model that fences anyway should not ship
 * backticks into the composer.
 * @param text - raw model output.
 * @returns the cleaned brief.
 */
function normalizeOutput(text) {
  let out = text.trim()
  const fenced = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(out)
  if (fenced !== null) out = fenced[1].trim()
  return out
}

/**
 * Run one craft call and stream nothing: the UI shows a spinner, and a 3s
 * round trip is simpler and safer than an SSE bridge for a single button.
 * @param ctx - host context.
 * @param cfg - normalized config.
 * @param body - parsed request body.
 * @returns the response payload and status.
 */
/** Reasoning efforts the LLM service accepts; anything else is ignored. */
const EFFORTS = ['off', 'low', 'high', 'inherit']

/**
 * Pick the effort for one call: an explicit, valid request value wins over the
 * configured default. Per-call override keeps the expensive effort available
 * for the hard drafts without charging it to every keystroke-then-click.
 * @param body - parsed request body.
 * @param cfg - normalized config.
 * @returns the effort to pass (or 'inherit' to omit the field).
 */
function pickEffort(body, cfg) {
  return typeof body.reasoningEffort === 'string' && EFFORTS.includes(body.reasoningEffort)
    ? body.reasoningEffort
    : cfg.reasoningEffort
}

async function craft(ctx, cfg, body) {
  const text = typeof body.text === 'string' ? body.text : ''
  const effort = pickEffort(body, cfg)
  if (text.trim() === '') return { status: 400, payload: { ok: false, error: { code: 'empty', message: '草稿是空的，先写点什么。' } } }
  if ([...text].length > MAX_INPUT_CHARS) {
    return {
      status: 400,
      payload: { ok: false, error: { code: 'too-long', message: `原文 ${[...text].length} 字，超过上限 ${MAX_INPUT_CHARS} 字。` } },
    }
  }
  const route = resolveRoute(ctx, cfg)
  if (route === undefined) {
    return { status: 409, payload: { ok: false, error: { code: 'no-model', message: '找不到可用模型：请先在界面里选一个默认模型。' } } }
  }
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    return { status: 503, payload: { ok: false, error: { code: 'no-llm', message: 'llm 服务不可用。' } } }
  }

  const started = Date.now()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, cfg.timeoutMs)

  // The frame stays traceable: everything the model is allowed to treat as
  // user intent sits between the tags, and a closing tag inside the draft is
  // defused rather than trusted.
  const framed = `<draft>\n${text.replace(/<\/draft>/gi, '<\\/draft>')}\n</draft>`
  const options = {
    provider: route.provider,
    model: route.model,
    system: cfg.systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: framed }] }],
    temperature: cfg.temperature,
    maxTokens: cfg.maxOutputTokens,
    signal: controller.signal,
    purpose: 'prompt-craft',
  }
  if (effort !== 'inherit') options.reasoningEffort = effort
  if (typeof body.sessionId === 'string' && body.sessionId !== '') options.sessionId = body.sessionId

  const parts = []
  let finish
  try {
    for await (const chunk of llm.stream(options)) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        parts.push(chunk.text)
        continue
      }
      if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    clearTimeout(timer)
    const aborted = timedOut || (error !== null && typeof error === 'object' && error.name === 'AbortError')
    return {
      status: aborted ? 504 : 502,
      payload: {
        ok: false,
        error: {
          code: aborted ? 'timeout' : 'upstream',
          message: aborted
            ? `超过 ${Math.round(cfg.timeoutMs / 1000)} 秒没有返回。`
            : (error instanceof Error ? error.message : String(error)),
        },
      },
    }
  } finally {
    clearTimeout(timer)
  }

  const kind = finish !== null && typeof finish === 'object' ? finish.kind : undefined
  if (kind === 'max-tokens') {
    return {
      status: 502,
      payload: { ok: false, error: { code: 'max-tokens', message: '达到输出上限（maxOutputTokens），可在插件配置里调大。' } },
    }
  }
  if (kind === 'error' || kind === 'aborted') {
    const failure = finish !== null && typeof finish === 'object' ? finish.failure : undefined
    return {
      status: 502,
      payload: {
        ok: false,
        error: {
          code: 'upstream',
          message: `${failure !== undefined && typeof failure.message === 'string' ? failure.message : '模型调用失败'}（${kind}）`,
        },
      },
    }
  }

  const out = normalizeOutput(parts.join(''))
  if (out === '') {
    return { status: 502, payload: { ok: false, error: { code: 'empty-output', message: '模型返回了空内容。' } } }
  }
  return {
    status: 200,
    payload: { ok: true, text: out, provider: route.provider, model: route.model, effort, elapsedMs: Date.now() - started },
  }
}

/**
 * Serve one request under the prefix.
 * @param ctx - host context.
 * @param cfg - normalized config.
 * @param req - incoming request.
 * @param res - server response.
 */
async function serve(ctx, cfg, req, res) {
  try {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (pathname !== ENHANCE_PATH) return json(res, 404, { ok: false, error: { code: 'not-found', message: 'not found' } })
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: { code: 'method', message: 'POST only' } })

    let body
    try {
      const raw = await readBody(req)
      body = raw.trim() === '' ? {} : JSON.parse(raw)
    } catch (error) {
      const tooLarge = error !== null && typeof error === 'object' && error.code === 'too-large'
      return json(res, tooLarge ? 413 : 400, {
        ok: false,
        error: { code: tooLarge ? 'too-large' : 'bad-json', message: tooLarge ? '请求体过大。' : '请求体不是合法 JSON。' },
      })
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return json(res, 400, { ok: false, error: { code: 'bad-body', message: '请求体应为对象。' } })
    }

    const { status, payload } = await craft(ctx, cfg, body)
    return json(res, status, payload)
  } catch (error) {
    try {
      return json(res, 500, {
        ok: false,
        error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
      })
    } catch {
      return undefined
    }
  }
}

/** Cordis plugin name. */
export const name = 'prompt-craft'

/**
 * No hard service dependency: `webServer` and `llm` are both resolved lazily,
 * so this entry still loads in a composition that lacks either.
 */
export const inject = []

/**
 * Mount the host half.
 * @param ctx - registrant context.
 * @param config - patch `config:` block (optional).
 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config === undefined ? {} : config)
  ctx.inject(['webServer'], (routeCtx) => {
    const webserver = routeCtx.get('webServer')
    if (webserver === undefined || webserver === null || typeof webserver.register !== 'function') return
    routeCtx.effect(() => {
      const dispose = webserver.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => serve(ctx, cfg, req, res),
      })
      return () => {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {
          // Already torn down with the service.
        }
      }
    }, 'dsh-prompt-craft: enhance route')
  })
}

export { CRAFT_SYSTEM_PROMPT }
