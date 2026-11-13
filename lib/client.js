/**
 * Browser half of dsh-prompt-craft.
 *
 * Wired as a Harness client module: `window.__ModuleLoader__.load({ id, factory })`,
 * so React comes from the shell's module table (`require('react')`) and nothing
 * from `@deepseek-ai/dsh-client-*` is imported — only the slot contract, read
 * structurally.
 *
 * Two registrations, both optional and both failure-tolerant (a throw from
 * `apply` fails the whole web boot):
 * - `conversation.input.right` → the 锻造 button, next to dsh-prompt-enhance's.
 * - `conversation.input.dock`  → the result / undo bar above the composer.
 *
 * @module dsh-prompt-craft/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-craft',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    // createPortal comes from react-dom (declared in dsh.client.inject). Without
    // it the panel still renders, only inside the dock instead of over the page.
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }

    const ENDPOINT = '/prompt-craft/enhance'
    const STYLE_ID = 'dsh-prompt-craft-styles'

    /* ---------------------------------------------------------------- state */

    /** One shared store: the button starts a call, the dock renders it. */
    let state = { phase: 'idle' }
    const listeners = new Set()
    /** Replace the whole snapshot and notify. @param {object} next */
    function emit(next) {
      state = next
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch {
          // A broken subscriber must not break the others.
        }
      }
    }
    /** @param {() => void} listener @returns {() => void} */
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    /** @returns {object} */
    function snapshot() {
      return state
    }

    /* --------------------------------------------------------------- styles */

    const CSS = `
.dsh-pc-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 9px; border: none; border-radius: 6px;
  background: transparent; color: inherit; opacity: 0.75;
  font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.dsh-pc-btn:hover:not(:disabled) { opacity: 1; background: rgba(127,127,127,0.18); }
.dsh-pc-btn:disabled { opacity: 0.4; cursor: default; }
.dsh-pc-btn .dsh-pc-ico { font-size: 13px; }
.dsh-pc-btn.is-busy .dsh-pc-ico { animation: dsh-pc-spin 1s linear infinite; display: inline-block; }
@keyframes dsh-pc-spin { to { transform: rotate(360deg); } }

.dsh-pc-shell, .dsh-pc-panel {
  --pc-bg: #1f2127; --pc-fg: #e6e8ee; --pc-fg-dim: rgba(230,232,238,0.55);
  --pc-border: rgba(127,127,127,0.35); --pc-sep: rgba(127,127,127,0.22);
  --pc-hover: rgba(127,127,127,0.18); --pc-danger: #ffb4a8;
  background: var(--pc-bg); color: var(--pc-fg); font-size: 12px;
}
@media (prefers-color-scheme: light) {
  .dsh-pc-shell, .dsh-pc-panel {
    --pc-bg: #ffffff; --pc-fg: #1c1e24; --pc-fg-dim: rgba(28,30,36,0.55);
    --pc-border: rgba(0,0,0,0.16); --pc-sep: rgba(0,0,0,0.10);
    --pc-hover: rgba(0,0,0,0.07); --pc-danger: #a63a2e;
  }
}

/* Ambient bar above the composer: loading / error / undo only. */
.dsh-pc-shell {
  margin: 4px 2px 6px; border-radius: 10px; border: 1px solid var(--pc-border);
  overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.25);
}

/* The long result lives in a fixed overlay portaled to <body>: it then owns the
   wheel over its own scroll container instead of competing with the composer,
   and it can be resized without pushing the input around. */
.dsh-pc-overlay {
  position: fixed; inset: 0; z-index: var(--pc-z, 1000);
  display: flex; align-items: flex-end; justify-content: center;
  padding: 24px 16px; background: rgba(0,0,0,0.32);
}
.dsh-pc-panel {
  display: flex; flex-direction: column;
  width: min(880px, 100%); min-height: 180px; max-height: 92vh;
  border-radius: 12px; border: 1px solid var(--pc-border);
  overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.45);
}
.dsh-pc-grip { flex: 0 0 auto; height: 9px; cursor: ns-resize; background: var(--pc-sep); opacity: 0.45; }
.dsh-pc-grip:hover { opacity: 1; background: var(--pc-hover); }
.dsh-pc-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pc-sep); font-weight: 600;
  cursor: move; user-select: none; touch-action: none; }
.dsh-pc-head:hover { background: var(--pc-hover); }
.dsh-pc-head:active { cursor: grabbing; }
.dsh-pc-dots { font-size: 12px; line-height: 1; letter-spacing: 1px; opacity: 0.4; }
.dsh-pc-head:hover .dsh-pc-dots { opacity: 0.95; }
.dsh-pc-meta { margin-left: auto; font-weight: 400; font-size: 11px; color: var(--pc-fg-dim); }
.dsh-pc-x { border: none; background: transparent; color: inherit; opacity: 0.55; cursor: pointer; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.dsh-pc-x:hover { opacity: 1; background: var(--pc-hover); }
.dsh-pc-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.dsh-pc-text { margin: 0; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12.5px; line-height: 1.65; }
.dsh-pc-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--pc-sep); }
.dsh-pc-grow { flex: 1; }
.dsh-pc-primary { border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; line-height: 1; cursor: pointer; background: #3f76e1; color: #fff; }
.dsh-pc-primary:hover { background: #4d82ec; }
.dsh-pc-plain { border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; line-height: 1; cursor: pointer; background: var(--pc-hover); color: inherit; }
.dsh-pc-plain:hover { background: rgba(127,127,127,0.3); }
.dsh-pc-load { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: var(--pc-fg-dim); }
.dsh-pc-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--pc-sep); border-top-color: #6ea8ff; animation: dsh-pc-spin 0.9s linear infinite; }
.dsh-pc-err { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: var(--pc-danger); }
.dsh-pc-undo { display: flex; align-items: center; gap: 8px; padding: 6px 10px; color: var(--pc-fg); opacity: 0.9; }
.dsh-pc-undo .dsh-pc-check { color: #7ed491; }
`
    /** Inject the stylesheet once per document. */
    function ensureStyles() {
      if (document.getElementById(STYLE_ID) !== null) return
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
    }

    /* ------------------------------------------------------------- requests */

    /**
     * Draft text out of the composer input state.
     * @param {unknown} inputState - one InputState snapshot.
     * @returns {string} the current draft.
     */
    function draftOf(inputState) {
      return inputState !== null && typeof inputState === 'object' && typeof inputState.draft === 'string'
        ? inputState.draft
        : ''
    }

    /**
     * Composer phase ('plain' when idle), read defensively across versions.
     * @param {unknown} inputState - one InputState snapshot.
     * @returns {string} the phase name.
     */
    function phaseOf(inputState) {
      return inputState !== null && typeof inputState === 'object' && typeof inputState.phase === 'string'
        ? inputState.phase
        : 'plain'
    }

    /**
     * Run one craft call and publish the outcome to the shared store.
     * @param {string} text - the draft to rewrite.
     * @param {string|undefined} sessionId - host session id, when exposed.
     * @param {string} [effort] - per-call reasoning effort ('high' for a hard draft).
     * @returns {Promise<void>} settles when the store is updated.
     */
    async function run(text, sessionId, effort) {
      if (typeof text !== 'string' || text.trim() === '') return
      const started = Date.now()
      emit({ phase: 'loading', original: text, effort })
      const payload = sessionId === undefined ? { text } : { text, sessionId }
      if (typeof effort === 'string' && effort !== '') payload.reasoningEffort = effort
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        let data = null
        try {
          data = await response.json()
        } catch {
          data = null
        }
        if (!response.ok || data === null || data.ok !== true) {
          const message = data !== null && data.error !== undefined && typeof data.error.message === 'string'
            ? data.error.message
            : `HTTP ${response.status}`
          emit({ phase: 'error', original: text, effort, message, elapsedMs: Date.now() - started })
          return
        }
        emit({
          phase: 'result',
          original: text,
          effort,
          text: typeof data.text === 'string' ? data.text : '',
          model: typeof data.model === 'string' ? data.model : '',
          elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : Date.now() - started,
        })
      } catch (error) {
        emit({
          phase: 'error',
          original: text,
          effort,
          message: error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error),
          elapsedMs: Date.now() - started,
        })
      }
    }

    /* ------------------------------------------------------------ components */

    /**
     * The 锻造 trigger in the composer tool row.
     * @param {{useInput: Function, inputActions: object, sessionId?: string}} props - slot standard props.
     * @returns {object|null} the button.
     */
    function CraftButton(props) {
      const useInput = props.useInput
      const draft = useInput(draftOf)
      const phase = useInput(phaseOf)
      const store = React.useSyncExternalStore(subscribe, snapshot)
      const busy = store.phase === 'loading'
      const disabled = busy || draft.trim() === '' || phase !== 'plain'
      const title = busy
        ? '正在锻造…'
        : draft.trim() === ''
          ? '先写点粗略的想法，再点锻造'
          : phase !== 'plain'
            ? '输入框忙（正在发送或等待回复）'
            : '把草稿补成任务简报：目标 / 红线 / 验收（Ctrl+Alt+K）'
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-pc-btn' + (busy ? ' is-busy' : ''),
          disabled,
          title,
          'aria-label': '锻造提示词',
          onClick: () => {
            void run(draft, props.sessionId)
          },
        },
        h('span', { className: 'dsh-pc-ico' }, busy ? '◌' : '✦'),
        h('span', null, busy ? '锻造中' : '锻造'),
      )
    }

    /**
     * Offset limits for a panel drag, measured against the viewport edges.
     *
     * `rect` is the panel's rect *at the moment the drag starts*, which already
     * includes the offset the panel is sitting at. Feeding that rect straight into
     * the limits makes every new drag believe the panel is at its resting place, so
     * each drag loses the distance already travelled — the second attempt to push
     * the panel up would stop at once, or snap it back. The offset is therefore
     * removed first, and the limits are expressed as the offset the panel may end
     * at (8px of air on each side, so it never ends up flush with an edge).
     *
     * @param {{left:number,right:number,top:number,bottom:number}} rect - panel rect including its current offset.
     * @param {{x:number,y:number}} offset - offset applied to the panel when the drag starts.
     * @param {{width:number,height:number}} view - viewport size.
     * @returns {{minX:number,maxX:number,minY:number,maxY:number}} allowed offset.
     */
    function dragBounds(rect, offset, view) {
      const margin = 8
      const left = rect.left - offset.x
      const right = rect.right - offset.x
      const top = rect.top - offset.y
      const bottom = rect.bottom - offset.y
      return {
        minX: margin - left,
        maxX: view.width - margin - right,
        minY: margin - top,
        maxY: view.height - margin - bottom,
      }
    }

    /**
     * Result, error, and undo bar above the composer.
     * @param {{useInput: Function, inputActions: {setDraft: Function}, sessionId?: string}} props - slot standard props.
     * @returns {object|null} the bar, or null while idle.
     */
    function CraftDock(props) {
      const useInput = props.useInput
      const draft = useInput(draftOf)
      const store = React.useSyncExternalStore(subscribe, snapshot)

      // Panel height: null = the default 'compact / tall' preset, a number = the
      // pixel height the user dragged out of the top grip.
      const [panelHeight, setPanelHeight] = React.useState(null)
      const [tall, setTall] = React.useState(false)
      // Position offset from the default bottom-centered spot: the panel can be
      // dragged anywhere that keeps it fully on screen.
      const [offset, setOffset] = React.useState({ x: 0, y: 0 })
      // True while the title bar is held: drives the grabbing cursor, and the same
      // cursor is pinned on <body> so the feedback survives the pointer leaving.
      const [dragging, setDragging] = React.useState(false)

      // The undo offer is temporary: it is a safety net for the next few
      // seconds, not a permanent second copy of the draft in memory.
      React.useEffect(() => {
        if (store.phase !== 'applied') return undefined
        const timer = setTimeout(() => emit({ phase: 'idle' }), 20000)
        return () => clearTimeout(timer)
      }, [store.phase])

      // Escape closes the overlay; the keyboard listener only exists while it is
      // open, so it never competes with the composer.
      React.useEffect(() => {
        if (store.phase !== 'result') return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) emit({ phase: 'idle' })
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [store.phase])

      // A fresh brief always opens where it belongs; only a drag moves it.
      React.useEffect(() => {
        if (store.phase !== 'result') return undefined
        setOffset({ x: 0, y: 0 })
        return undefined
      }, [store.phase])

      const heightText = panelHeight === null ? (tall ? '92vh' : '62vh') : `${panelHeight}px`

      /**
       * Pin a cursor on <body> for the length of a drag: the pointer regularly
       * leaves the 9px grip or the 30px title bar, and the cursor must not snap
       * back to an arrow halfway through the gesture.
       */
      function lockCursor(cursor) {
        const body = typeof document === 'undefined' ? undefined : document.body
        if (body === undefined || body === null || body.style === undefined || body.style === null) return () => undefined
        const previous = body.style.cursor
        body.style.cursor = cursor
        return () => {
          body.style.cursor = previous
        }
      }

      /** Drag the grip above the panel to change its height. */
      const startResize = (event) => {
        if (typeof event.clientY !== 'number') return
        const panel = event.currentTarget.parentElement
        const box = panel === null || panel === undefined ? null : panel.getBoundingClientRect()
        const startY = event.clientY
        const startHeight = box === null ? 420 : box.height
        const limit = typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight * 0.92 : 900
        const move = (moveEvent) => {
          const next = startHeight + (startY - moveEvent.clientY)
          setPanelHeight(Math.max(180, Math.min(limit, Math.round(next))))
        }
        const releaseCursor = lockCursor('ns-resize')
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          releaseCursor()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        event.preventDefault()
      }

      /**
       * Drag the title bar to move the panel. The limits keep the whole panel on
       * screen, so it can never be dragged out of reach — and they are measured
       * against the panel's rested position, so a second drag that starts at the top
       * edge can still travel back down (see {@link dragBounds}).
       */
      const startMove = (event) => {
        if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return
        if (typeof event.button === 'number' && event.button !== 0) return
        const source = event.target
        if (source !== null && source !== undefined && typeof source.closest === 'function' && source.closest('button') !== null) return
        const panel = event.currentTarget === null ? null : event.currentTarget.parentElement
        if (panel === null || panel === undefined) return
        const box = panel.getBoundingClientRect()
        const startX = event.clientX
        const startY = event.clientY
        const baseX = offset.x
        const baseY = offset.y
        const viewWidth = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 1280
        const viewHeight = typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 800
        const bounds = dragBounds(box, offset, { width: viewWidth, height: viewHeight })
        const clamp = (value, low, high) => (high < low ? low : Math.max(low, Math.min(high, value)))
        const move = (moveEvent) => {
          setOffset({
            x: Math.round(clamp(baseX + (moveEvent.clientX - startX), bounds.minX, bounds.maxX)),
            y: Math.round(clamp(baseY + (moveEvent.clientY - startY), bounds.minY, bounds.maxY)),
          })
        }
        const releaseCursor = lockCursor('grabbing')
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          releaseCursor()
          setDragging(false)
        }
        setDragging(true)
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        event.preventDefault()
      }

      if (store.phase === 'idle') return null
      const close = () => emit({ phase: 'idle' })

      if (store.phase === 'loading') {
        return h(
          'div',
          { className: 'dsh-pc-shell' },
          h(
            'div',
            { className: 'dsh-pc-load' },
            h('span', { className: 'dsh-pc-dot' }),
            h('span', null, store.effort === 'high' ? '正在深度锻造任务简报…（约十几秒）' : '正在锻造任务简报…'),
          ),
        )
      }

      if (store.phase === 'error') {
        return h(
          'div',
          { className: 'dsh-pc-shell' },
          h(
            'div',
            { className: 'dsh-pc-err' },
            h('span', null, '✕'),
            h('span', { className: 'dsh-pc-grow' }, store.message),
            h('button', { className: 'dsh-pc-plain', onClick: () => void run(store.original, props.sessionId, store.effort) }, '重试'),
            h('button', { className: 'dsh-pc-x', onClick: close, title: '关闭' }, '✕'),
          ),
        )
      }

      if (store.phase === 'applied') {
        return h(
          'div',
          { className: 'dsh-pc-shell' },
          h(
            'div',
            { className: 'dsh-pc-undo' },
            h('span', { className: 'dsh-pc-check' }, '✓'),
            h('span', { className: 'dsh-pc-grow' }, '已填入输入框'),
            h(
              'button',
              {
                className: 'dsh-pc-plain',
                onClick: () => {
                  props.inputActions.setDraft(store.undoText === undefined ? '' : store.undoText)
                  close()
                },
              },
              '撤销',
            ),
            h('button', { className: 'dsh-pc-x', onClick: close, title: '关闭' }, '✕'),
          ),
        )
      }

      const chars = [...store.text].length
      const before = [...store.original].length
      const panel = h(
        'div',
        {
          className: 'dsh-pc-overlay',
          role: 'dialog',
          'aria-label': '任务简报',
          // Clicking the dimmed backdrop closes; clicking inside the panel must not.
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close()
          },
        },
        h(
          'div',
          { className: 'dsh-pc-panel', style: { maxHeight: heightText, transform: `translate(${offset.x}px, ${offset.y}px)` } },
          h('div', { className: 'dsh-pc-grip', title: '上下拖动调整高度', onPointerDown: startResize }),
          h(
            'div',
            {
              className: 'dsh-pc-head',
              title: '拖动此栏移动浮层，双击复位',
              style: { cursor: dragging ? 'grabbing' : 'move' },
              onPointerDown: startMove,
              onDoubleClick: () => setOffset({ x: 0, y: 0 }),
            },
            h('span', { className: 'dsh-pc-dots', 'aria-hidden': 'true' }, '⠿'),
            h('span', null, '✦ 任务简报'),
            h(
              'span',
              { className: 'dsh-pc-meta' },
              `${before} → ${chars} 字 · ${Math.max(1, Math.round(store.elapsedMs / 100) / 10)}s` + (store.model === '' ? '' : ` · ${store.model}`),
            ),
            h(
              'button',
              {
                className: 'dsh-pc-x',
                title: tall ? '还原高度' : '放到最大',
                'aria-label': tall ? '还原高度' : '放到最大',
                onClick: () => {
                  setPanelHeight(null)
                  setTall(!tall)
                },
              },
              tall ? '⤡' : '⤢',
            ),
            h('button', { className: 'dsh-pc-x', onClick: close, title: '关闭（Esc）' }, '✕'),
          ),
          h('div', { className: 'dsh-pc-body' }, h('pre', { className: 'dsh-pc-text' }, store.text)),
          h(
            'div',
            { className: 'dsh-pc-foot' },
            h(
              'button',
              {
                className: 'dsh-pc-primary',
                onClick: () => {
                  const previous = draft
                  props.inputActions.setDraft(store.text)
                  emit({ phase: 'applied', undoText: previous })
                },
              },
              '采用并填入',
            ),
            h('button', { className: 'dsh-pc-plain', title: '重跑一次（同样的加力档位）', onClick: () => void run(store.original, props.sessionId, store.effort) }, '再试一次'),
            h(
              'button',
              {
                className: 'dsh-pc-plain',
                title: '让模型多想一会儿再写一遍（更慢，通常更细）',
                onClick: () => void run(store.original, props.sessionId, 'high'),
              },
              '深度重写',
            ),
            h('span', { className: 'dsh-pc-grow' }),
            h('span', { className: 'dsh-pc-meta' }, '采用后可撤销'),
          ),
        ),
      )
      // A fixed overlay must be portaled to <body>: only then does it sit above
      // the composer and own its own scrolling.
      const target = document.body === undefined ? document.documentElement : document.body
      return ReactDOM === null || target === undefined || target === null ? panel : ReactDOM.createPortal(panel, target)
    }

    /* ------------------------------------------------------------------ glue */

    /**
     * Report one failed optional wiring step and keep booting.
     * @param {string} step - which registration failed.
     * @param {unknown} error - the thrown value.
     * @returns {() => void} a no-op disposer.
     */
    function report(step, error) {
      try {
        console.warn(`[prompt-craft] ${step} failed; that part stays off.`, error)
      } catch {
        // A throwing console must not turn a degraded feature into a failed boot.
      }
      return () => {}
    }

    /**
     * Register one component into a slot, tolerating a missing slots service.
     * @param {object} ctx - client context.
     * @param {string} slot - slot name.
     * @param {string} id - registration id (unique per slot).
     * @param {number} order - sort order within the slot.
     * @param {object} component - React component.
     * @returns {unknown} the disposer chain.
     */
    function mount(ctx, slot, id, order, component) {
      return ctx.inject(['slots'], (slotsCtx) => {
        const slots = slotsCtx === null || slotsCtx === undefined ? undefined : slotsCtx.slots
        if (slots === undefined || slots === null || typeof slots.register !== 'function') return undefined
        return slots.inject(slot, () => {
          try {
            return slots.register({ name: slot, id, order }, component)
          } catch (error) {
            return report(`${slot} registration`, error)
          }
        })
      })
    }

    /** Apply the browser half. @param {object} ctx - client context. */
    function apply(ctx) {
      try {
        ensureStyles()
      } catch {
        // Cosmetic only: an unstyled button still works.
      }
      mount(ctx, 'conversation.input.right', 'prompt-craft', 61, CraftButton)
      mount(ctx, 'conversation.input.dock', 'prompt-craft-result', 91, CraftDock)

      // Ctrl+Alt+K runs the same action as the button. Capture phase so the
      // shell's own handlers do not swallow the combo first; never prevent a
      // default unless this plugin actually acts.
      ctx.effect(() => {
        const onKeyDown = (event) => {
          if (event.defaultPrevented || event.isComposing) return
          if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return
          if (String(event.key).toLowerCase() !== 'k') return
          const root = document.querySelector('.dsh-pc-btn')
          if (root === null || root.disabled) return
          event.preventDefault()
          event.stopPropagation()
          root.click()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, 'dsh-prompt-craft: shortcut')
    }

    exports.apply = apply
    exports.inject = []
    exports.name = 'prompt-craft'
    // Test seam: the drag math is pure and worth asserting without a DOM.
    exports.__test = { dragBounds }
    return module.exports
  },
})
