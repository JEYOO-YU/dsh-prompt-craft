/**
 * Smoke test for the browser half, run in Node with a stub React: it proves the
 * module loads in the `__ModuleLoader__` shape, registers both slots, and that
 * 锻造 → 采用 → 撤销 drives `inputActions.setDraft` in the right order.
 *
 * Run: node smoke/client-smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/* --------------------------------------------------------------- stub React */

const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) },
  }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useEffect: () => undefined,
  useMemo: (fn) => fn(),
  useState: (initial) => [initial, (value) => stateWrites.push(value)],
}

/** Every value written through a useState setter, so drag effects are observable. */
const stateWrites = []

/** The panel is portaled to <body>; the stub just hands the element back. */
const ReactDOM = {
  createPortal: (element) => element,
}

/** Collect every element in a rendered tree, in order. */
function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node)
  if (node.props !== undefined && node.props.children !== undefined) flatten(node.props.children, out)
  return out
}

/** All rendered strings joined, for text assertions. */
function textOf(node) {
  return flatten(node)
    .flatMap((element) => (typeof element === 'string' ? [element] : typeof element === 'object' ? [] : [String(element)]))
    .concat(collectStrings(node))
    .join('')
}

function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) collectStrings(child, out)
  else if (node !== null && typeof node === 'object' && node.props !== undefined) collectStrings(node.props.children, out)
  return out
}

/** Find the first element whose props match a predicate. */
function find(node, predicate) {
  return flatten(node).find((element) => element !== null && typeof element === 'object' && predicate(element)) ?? null
}

/* -------------------------------------------------------------- stub window */

let loaded = null
const styleElements = []
const listeners = []
globalThis.document = {
  head: { appendChild: (element) => styleElements.push(element) },
  body: { tag: 'body' },
  documentElement: { tag: 'html' },
  createElement: (tag) => ({ tag, id: '', textContent: '' }),
  getElementById: (id) => styleElements.find((element) => element.id === id) ?? null,
  querySelector: (selector) => (selector === '.dsh-pc-btn' ? { disabled: false, click: () => undefined } : null),
  addEventListener: (type, listener) => listeners.push({ type, listener }),
  removeEventListener: (type, listener) => {
    const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
    if (index >= 0) listeners.splice(index, 1)
  },
}
const windowListeners = []
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: (type, listener) => windowListeners.push({ type, listener }),
  removeEventListener: (type, listener) => {
    const index = windowListeners.findIndex((entry) => entry.type === type && entry.listener === listener)
    if (index >= 0) windowListeners.splice(index, 1)
  },
  __ModuleLoader__: {
    load: (definition) => {
      loaded = definition
    },
  },
}

/* ------------------------------------------------------------- load the half */

const fakeRequire = (id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return ReactDOM
  assert.fail(`unexpected require('${id}')`)
}
new Function('window', 'document', source)(globalThis.window, globalThis.document ?? {})
assert.equal(loaded?.id, 'dsh-prompt-craft', 'module id must be the package name')

const registry = []
const slots = {
  inject: (slot, callback) => callback(),
  register: (registration, component) => {
    registry.push({ registration, component })
    return () => undefined
  },
}
const ctx = {
  inject: (_deps, callback) => callback({ slots }),
  effect: (factory) => factory(),
}
const module = loaded.factory(fakeRequire)
assert.equal(typeof module.apply, 'function', 'apply must be exported')
module.apply(ctx)

assert.equal(registry.length, 2, 'both slots must be registered')
assert.deepEqual(
  registry.map((entry) => [entry.registration.name, entry.registration.id, entry.registration.order]),
  [
    ['conversation.input.right', 'prompt-craft', 61],
    ['conversation.input.dock', 'prompt-craft-result', 91],
  ],
  'slot ids and orders must stay clear of dsh-prompt-enhance (60 / 90)',
)

const button = registry[0].component
const dock = registry[1].component

/* ------------------------------------------------------- interaction journey */

const drafts = []
const props = (draft, phase = 'plain') => ({
  useInput: (selector) => selector({ draft, phase }),
  inputActions: {
    setDraft: (next) => {
      drafts.push(next)
    },
  },
  sessionId: 's1',
})

// 1. Empty draft: the button must be disabled, never fire a request.
let requests = 0
globalThis.fetch = async () => {
  requests += 1
  return { ok: true, status: 200, json: async () => ({ ok: true, text: 'BRIEF', model: 'm', elapsedMs: 1200 }) }
}
const idle = button(props('   '))
assert.equal(idle.props.disabled, true, 'empty draft must disable the button')
idle.props.onClick()
await Promise.resolve()
assert.equal(requests, 0, 'empty draft must not call the server')

// 2. Busy composer: still disabled.
assert.equal(button(props('hello', 'streaming')).props.disabled, true, 'busy composer must disable the button')

// 3. Happy path: click → result panel → 采用并填入 → 撤销.
const readyProps = props('hello world')
const clicked = button(readyProps)
assert.equal(clicked.props.disabled, false, 'a plain draft must enable the button')
clicked.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))

const result = dock(readyProps)
const panelText = collectStrings(result).join('')
assert.match(panelText, /任务简报/, 'result panel must render')
assert.match(panelText, /BRIEF/, 'result panel must show the rewritten text')
assert.equal(find(result, (element) => element.props?.className === 'dsh-pc-overlay') !== null, true, 'result must be a fixed overlay')
const panelElement = find(result, (element) => element.props?.className === 'dsh-pc-panel')
assert.equal(panelElement !== null, true, 'overlay must contain the resizable panel')
assert.match(String(panelElement?.props?.style?.transform), /^translate\(/, 'panel must be positioned by a transform so it can be dragged')
assert.equal(find(result, (element) => element.props?.className === 'dsh-pc-grip') !== null, true, 'panel must expose the resize grip')
const headElement = find(result, (element) => element.props?.className === 'dsh-pc-head')
assert.equal(typeof headElement?.props?.onPointerDown, 'function', 'title bar must start a drag')
assert.equal(typeof headElement?.props?.onDoubleClick, 'function', 'title bar must reset its position on double click')

// 3b. Dragging the title bar moves the panel, and the limits keep it reachable.
const rect = { left: 200, right: 1080, top: 300, bottom: 700, width: 880, height: 400 }
const offsetsWritten = () => stateWrites.filter((value) => typeof value === 'object' && value !== null && 'x' in value)
stateWrites.length = 0
headElement.props.onPointerDown({
  clientX: 500,
  clientY: 320,
  button: 0,
  target: { closest: () => null },
  currentTarget: { parentElement: { getBoundingClientRect: () => rect } },
  preventDefault: () => undefined,
})
const moveListener = windowListeners.find((entry) => entry.type === 'pointermove')
assert.ok(moveListener !== undefined, 'a drag must attach a pointermove listener')
moveListener.listener({ clientX: 99999, clientY: 99999 })
assert.deepEqual(offsetsWritten().pop(), { x: 1280 - 8 - rect.right, y: 800 - 8 - rect.bottom }, 'drag must clamp the panel inside the viewport')
moveListener.listener({ clientX: 500, clientY: 320 })
assert.deepEqual(offsetsWritten().pop(), { x: 0, y: 0 }, 'dragging back to the origin must restore the default spot')
const upListener = windowListeners.find((entry) => entry.type === 'pointerup')
assert.ok(upListener !== undefined, 'a drag must attach a pointerup listener')
upListener.listener()
assert.equal(windowListeners.some((entry) => entry.type === 'pointermove'), false, 'pointerup must release the drag listeners')
assert.equal(find(result, (element) => collectStrings(element).join('') === '采用并填入') !== null, true, 'adopt button must exist')

const adopt = find(result, (element) => element.props?.onClick !== undefined && collectStrings(element).join('') === '采用并填入')
adopt.props.onClick()
assert.deepEqual(drafts, ['BRIEF'], 'adopt must write the brief into the composer')

const applied = dock(readyProps)
const undo = find(applied, (element) => element.props?.onClick !== undefined && collectStrings(element).join('') === '撤销')
assert.ok(undo !== null, 'undo bar must exist after adopt')
undo.props.onClick()
assert.deepEqual(drafts, ['BRIEF', 'hello world'], 'undo must restore the pre-adopt draft')

// 4. Failure path: error bar with retry, and the composer is untouched.
globalThis.fetch = async () => ({
  ok: false,
  status: 502,
  json: async () => ({ ok: false, error: { code: 'upstream', message: '模型调用失败' } }),
})
button(props('hello')).props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
const failed = dock(props('hello'))
assert.match(collectStrings(failed).join(''), /模型调用失败/, 'error bar must show the server message')
assert.deepEqual(drafts, ['BRIEF', 'hello world'], 'a failed run must never touch the draft')

// 5. 深度重写 asks the server for the expensive effort, and says so while loading.
let lastBody = null
globalThis.fetch = async (_url, init) => {
  lastBody = JSON.parse(init.body)
  return { ok: true, status: 200, json: async () => ({ ok: true, text: 'BRIEF2', model: 'm', elapsedMs: 9000 }) }
}
button(props('hello')).props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(lastBody.reasoningEffort, undefined, 'a normal run must not force an effort')

const deepPanel = dock(props('hello'))
const deep = find(deepPanel, (element) => element.props?.onClick !== undefined && collectStrings(element).join('') === '深度重写')
assert.ok(deep !== null, 'the result panel must offer 深度重写')
deep.props.onClick()
assert.equal(lastBody.reasoningEffort, 'high', '深度重写 must request high effort')
assert.match(collectStrings(dock(props('hello'))).join(''), /深度锻造/, 'the loading bar must say the deep run is slower')

console.log('client smoke: 5 scenarios passed')
