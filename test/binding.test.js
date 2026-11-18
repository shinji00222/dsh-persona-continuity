import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'

function createHarness(t, { sessions, agents, observations = {}, llmResult = '[]' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-binding-test-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir

  const handlers = new Map()
  const routes = new Map()
  const cleanups = []

  const ctx = {
    logger: { warn() {} },
    agents: {
      get: id => agents.get(id),
      list: () => [...agents.values()],
    },
    sessions: {
      get: id => sessions.get(id),
    },
    systemPrompt: {
      section: () => () => {},
      context: () => () => {},
    },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: llmResult }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    connection: {
      fetch: {
        register({ path, methods, fetch }) {
          for (const method of methods) routes.set(`${method} ${path}`, fetch)
          return async () => {}
        },
      },
    },
    sessionQuery: {
      async observeSession(id) {
        const obs = observations[id]
        if (!obs) throw new Error('not found')
        return { ...obs, [Symbol.dispose]() {} }
      },
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }

  apply(ctx)

  t.after(async () => {
    for (const cleanup of cleanups) await cleanup()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(dir, { recursive: true, force: true })
  })

  async function callRoute(method, path, body) {
    const fn = routes.get(`${method} /api/persona-continuity${path.split('?')[0]}`)
    assert.ok(fn, `route ${method} ${path} should be registered`)
    const init = { method }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers = { 'content-type': 'application/json' }
    }
    const res = await fn(new Request('http://localhost/api/persona-continuity' + path, init))
    const json = await res.json()
    return { status: res.status, json }
  }

  async function emit(event, ...args) {
    for (const fn of handlers.get(event) ?? []) await fn(...args)
  }

  return { callRoute, emit }
}

const makeSession = (id, events = [], { busy = false } = {}) => ({
  id,
  header: { id, cwd: 'ws', createdAt: 100 },
  snapshotEvents: () => events,
  requestHeader: () => (busy ? { config: { provider: 'mock', model: 'm1' } } : undefined),
})

const makeAgent = (id, session) => ({
  id,
  session,
  options: { provider: 'mock', model: 'm1' },
  inbox: { nextTurn: [], nextStep: [] },
  ctx: {
    systemPrompt: {
      section: () => () => {},
      context: () => () => {},
    },
  },
})

test('binding rules: draft can rebind freely, started standard chat binds once, generating blocks all', async t => {
  const sDraft = makeSession('draft', [])
  const sHistory = makeSession('history', [
    { type: 'user/message', data: { source: { kind: 'user' }, content: 'hi' } },
  ])
  const sBusy = makeSession('busy', [], { busy: true })

  const sessions = new Map([['draft', sDraft], ['history', sHistory], ['busy', sBusy]])
  const agents = new Map([
    ['draft', makeAgent('draft', sDraft)],
    ['history', makeAgent('history', sHistory)],
    ['busy', makeAgent('busy', sBusy)],
  ])

  const { callRoute } = createHarness(t, { sessions, agents })

  const pA = (await callRoute('POST', '/persona', { id: '', name: 'A', instructions: '' })).json.id
  const pB = (await callRoute('POST', '/persona', { id: '', name: 'B', instructions: '' })).json.id

  // 1) 没有历史：A -> B -> 普通 都成功
  let state = (await callRoute('GET', '/state?session=draft')).json
  assert.equal(state.editable, true)
  assert.equal(state.bindOnce, false)
  assert.equal(state.locked, false)

  assert.equal((await callRoute('POST', '/bind', { session: 'draft', persona: pA })).status, 200)
  assert.equal((await callRoute('POST', '/bind', { session: 'draft', persona: pB })).status, 200)
  state = (await callRoute('POST', '/bind', { session: 'draft', persona: '' })).json
  assert.equal(state.selected, '')

  // 2) 有历史 + 未绑定 -> A 成功，之后锁定
  state = (await callRoute('GET', '/state?session=history')).json
  assert.equal(state.editable, false)
  assert.equal(state.bindOnce, true)
  assert.equal(state.locked, false)

  state = (await callRoute('POST', '/bind', { session: 'history', persona: pA })).json
  assert.equal(state.selected, pA)
  assert.equal(state.bindOnce, false)
  assert.equal(state.locked, true)

  // A -> B 失败, A -> 普通 失败, 创建新人格失败, A -> A 不报错
  assert.equal((await callRoute('POST', '/bind', { session: 'history', persona: pB })).status, 400)
  assert.equal((await callRoute('POST', '/bind', { session: 'history', persona: '' })).status, 400)
  assert.equal((await callRoute('POST', '/create', { session: 'history', name: 'C' })).status, 400)
  assert.equal((await callRoute('POST', '/bind', { session: 'history', persona: pA })).status, 200)

  // 3) 生成中：任何操作都失败
  state = (await callRoute('GET', '/state?session=busy')).json
  assert.equal(state.editable, false)
  assert.equal(state.bindOnce, false)
  assert.equal(state.locked, false)
  assert.equal((await callRoute('POST', '/bind', { session: 'busy', persona: pA })).status, 400)
  assert.equal((await callRoute('POST', '/create', { session: 'busy', name: 'D' })).status, 400)
})

test('importHistory skips sessions bound to another persona or busy without rebinding', async t => {
  const sActive = makeSession('active', [])
  const sOther = makeSession('other', [])
  const sBusy = makeSession('busy-chat', [], { busy: true })
  const sessions = new Map([['active', sActive], ['other', sOther], ['busy-chat', sBusy]])
  const agents = new Map([
    ['active', makeAgent('active', sActive)],
    ['other', makeAgent('other', sOther)],
    ['busy-chat', makeAgent('busy-chat', sBusy)],
  ])
  const observations = {
    other: {
      header: { id: 'other', cwd: 'ws' },
      events: [
        { type: 'user/message', data: { source: { kind: 'user' }, content: '记住这是重要决定' } },
        { type: 'assistant/message', data: { message: { content: '好的。' } } },
      ],
    },
  }
  const { callRoute } = createHarness(t, { sessions, agents, observations })

  const pA = (await callRoute('POST', '/persona', { id: '', name: 'A', instructions: '' })).json.id
  const pB = (await callRoute('POST', '/persona', { id: '', name: 'B', instructions: '' })).json.id
  await callRoute('POST', '/bind', { session: 'other', persona: pB })

  const res = await callRoute('POST', '/history/import', {
    persona: pA,
    sessions: ['other', 'busy-chat'],
    activeSession: 'active',
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.importedSessions, 0)
  assert.deepEqual(res.json.skipped, [
    { id: 'other', reason: 'bound-to-other' },
    { id: 'busy-chat', reason: 'busy' },
  ])
  assert.equal((await callRoute('GET', '/state?session=other')).json.selected, pB)
})

test('history lookup turn allows non-history tools, denies native history tools, and still enqueues extraction', async t => {
  const sChat = makeSession('chat', [])
  const agent = makeAgent('chat', sChat)
  const sessions = new Map([['chat', sChat]])
  const agents = new Map([['chat', agent]])
  let llmCalls = 0
  const dir = mkdtempSync(join(tmpdir(), 'dsh-t2-test-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir

  const handlers = new Map()
  const routes = new Map()
  const cleanups = []
  const ctx = {
    logger: { warn() {} },
    agents: { get: id => agents.get(id), list: () => [...agents.values()] },
    sessions: { get: id => sessions.get(id) },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    llm: {
      async *stream() {
        llmCalls++
        yield {
          type: 'text-delta',
          text: JSON.stringify([{
            kind: 'decision', topic: 't2-topic', title: '工具放行', summary: '读文件正常',
            detail: '找之前聊 SQLite 的那段 并继续改代码', evidence: '找之前聊 SQLite 的那段',
          }]),
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    connection: {
      fetch: {
        register({ path, methods, fetch }) {
          for (const method of methods) routes.set(`${method} ${path}`, fetch)
          return async () => {}
        },
      },
    },
    sessionQuery: {
      async filterSessions() { return [] },
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  apply(ctx)
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup()
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(dir, { recursive: true, force: true })
  })

  const call = async (method, path, body) => {
    const fn = routes.get(`${method} /api/persona-continuity${path.split('?')[0]}`)
    const res = await fn(new Request('http://localhost/api/persona-continuity' + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: body ? { 'content-type': 'application/json' } : {},
    }))
    return res.json()
  }
  const emit = async (event, ...args) => {
    for (const fn of handlers.get(event) ?? []) await fn(...args)
  }

  const pA = (await call('POST', '/persona', { id: '', name: 'A', instructions: '' })).id
  await call('POST', '/bind', { session: 'chat', persona: pA })

  await emit('session/event', sChat, { type: 'turn/start', data: { turn: 1 } })
  await emit('agent/pre-step', {
    agent,
    messages: [{ source: { kind: 'user' }, content: '找之前聊 SQLite 的那段' }],
    signal: new AbortController().signal,
  }, () => ({ ok: true }))

  // 非历史工具走 next()
  let nextCalled = false
  const allowed = await (async () => {
    for (const fn of handlers.get('tools/pre-execute') ?? []) {
      const result = await fn({ agent, name: 'read_file' }, () => { nextCalled = true; return { kind: 'allow' } })
      if (result) return result
    }
  })()
  assert.equal(nextCalled, true)
  assert.deepEqual(allowed, { kind: 'allow' })

  // nativeHistoryTools 仍被 deny
  const denied = await (async () => {
    for (const fn of handlers.get('tools/pre-execute') ?? []) {
      const result = await fn({ agent, name: 'session_search' }, () => ({ kind: 'allow' }))
      if (result) return result
    }
  })()
  assert.equal(denied.kind, 'deny')

  // turn/end 仍然入队并触发提炼
  await emit('session/event', sChat, { type: 'user/message', data: { source: { kind: 'user' }, content: '找之前聊 SQLite 的那段' } })
  await emit('session/event', sChat, { type: 'assistant/message', data: { message: { content: '好的，继续改代码。' } } })
  await emit('session/event', sChat, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(llmCalls >= 1)
  const indexed = await call('GET', `/index?persona=${pA}&q=t2-topic`)
  assert.equal(indexed.length, 1)
})
