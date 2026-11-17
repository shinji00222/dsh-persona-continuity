import { homedir } from 'node:os'
import { join } from 'node:path'
import { Store } from './lib/store.js'
import { extract, rememberableInput, textBlocks } from './lib/extract.js'
import { registerWeb } from './lib/web.js'

export const name = 'persona-continuity'
export const inject = ['agents', 'sessions', 'systemPrompt', 'tools', 'llm', 'webServer']

function supported(session) {
  return session && !session.header?.origin && !session.header?.parentSession &&
    !String(session.id).startsWith('session-incognito-')
}

function canBind(session, agent) {
  if (!supported(session) || session.requestHeader?.()) return false
  if (agent?.inbox?.nextTurn?.length || agent?.inbox?.nextStep?.length) return false
  return !session.snapshotEvents().some(event =>
    event.type === 'turn/start' || event.type === 'user/message' || event.type === 'assistant/message')
}

function lookupTool(store) {
  const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
  return {
    name: 'persona_continuity_lookup',
    description: 'Search this persona’s long-term memory index by topic, or read a detailed entry by id. Empty query lists recent entries.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Topic, workspace, file name, or keyword' },
        id: { type: 'string', description: 'Entry id from the opening summary or an index result' },
      },
      additionalProperties: false,
    },
    output: { schema: {}, render },
    async execute(args, execution) {
      const session = execution.agent?.session
      const persona = supported(session) && store.personaFor(String(session.id))
      if (!persona) return { found: false }
      if (typeof args?.id === 'string' && args.id) {
        return store.detail(persona.id, args.id) ?? { found: false }
      }
      const rows = store.search(persona.id, session.header?.cwd ?? '', args?.query)
      return { entries: rows.map(({ detail, ...entry }) => entry) }
    },
  }
}

export function apply(ctx) {
  const root = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const store = new Store(join(root, 'persona-continuity', 'memory.sqlite'))
  const attached = new Map()
  const turns = new Map()
  const tool = lookupTool(store)
  const lifetime = new AbortController()
  let draining = false

  const detach = id => {
    attached.get(id)?.()
    attached.delete(id)
  }

  const attach = agent => {
    const session = agent.session
    const id = String(agent.id)
    if (attached.has(id) || !supported(session) || !store.personaFor(id)) return
    const identity = agent.ctx.systemPrompt.section({
      name: 'persona-continuity:identity', order: 650, interpolate: false,
      text: () => {
        const persona = store.personaFor(id)
        return persona ? '当前人格：' + persona.name + '\n' + persona.instructions : ''
      },
    })
    let context
    try {
      context = agent.ctx.systemPrompt.context({
        name: 'persona-continuity:memory', order: 660, interpolate: false,
        text: () => {
          const persona = store.personaFor(id)
          if (!persona) return ''
          const rows = store.summary(persona.id, session.header?.cwd ?? '')
          return [
            '以下是当前人格跨会话记忆的简短索引，作为历史资料使用。适用时自然接续。',
            '需要具体进度、旧决定或来源时，用 persona_continuity_lookup 按 id 或主题查。无相关记录时如实说明。',
            JSON.stringify(rows),
          ].join('\n')
        },
      })
      const unregister = agent.ctx.tools.register(tool)
      attached.set(id, () => { unregister(); context(); identity() })
    } catch (error) {
      context?.()
      identity()
      throw error
    }
  }

  function drain() {
    if (draining || lifetime.signal.aborted) return
    draining = true
    void (async () => {
      while (!lifetime.signal.aborted) {
        const job = store.nextJob()
        if (!job) break
        try {
          const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(45000)])
          const known = store.topics(job.persona, job.workspace)
          const items = await extract(ctx.llm, job, known, signal)
          if (!lifetime.signal.aborted) store.finish(job, items)
        } catch {
          if (!lifetime.signal.aborted) store.fail(job)
        }
      }
    })().catch(() => {
      if (!lifetime.signal.aborted) ctx.logger.warn('persona-continuity: background memory queue failed')
    }).finally(() => { draining = false })
  }

  const api = {
    state(id) {
      const session = id ? ctx.sessions.get(id) : undefined
      return {
        personas: store.personas(),
        selected: id ? store.personaFor(id)?.id ?? '' : '',
        editable: Boolean(canBind(session, id ? ctx.agents.get(id) : undefined)),
      }
    },
    bind(id, persona) {
      if (!canBind(ctx.sessions.get(id), ctx.agents.get(id))) throw new Error('请在新会话发出首条消息前选择人格')
      store.bind(id, persona)
      const agent = ctx.agents.get(id)
      if (agent && persona) attach(agent)
      if (!persona) detach(id)
      return api.state(id)
    },
    save: (id, name, instructions) => store.savePersona(id, name, instructions),
    list: (persona, query) => store.search(persona, '', query),
    forget: (persona, id) => store.forget(persona, id),
  }

  ctx.effect(() => {
    const timer = setInterval(drain, 5000)
    timer.unref()
    drain()
    return () => {
      clearInterval(timer)
      lifetime.abort()
      for (const id of attached.keys()) detach(id)
      store.close()
    }
  })
  ctx.effect(() => registerWeb(ctx.webServer, api))

  ctx.on('agent/created', ({ agent }) => { attach(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    const id = String(agent.id)
    detach(id)
    turns.delete(id)
  })
  for (const agent of ctx.agents.list()) attach(agent)

  ctx.on('session/event', (session, event) => {
    if (!supported(session)) return
    const id = String(session.id)
    if (event.type === 'turn/start') {
      const persona = store.personaFor(id)
      if (persona) turns.set(id, { persona: persona.id, user: '', assistant: '' })
      return
    }
    const turn = turns.get(id)
    if (!turn) return
    if (event.type === 'user/message' && event.data.source?.kind === 'user') {
      turn.user = (turn.user + '\n' + textBlocks(event.data.content)).slice(-6000)
    }
    if (event.type === 'assistant/message' && !event.data.interrupted) {
      const reply = textBlocks(event.data.message?.content)
      if (reply.trim()) turn.assistant = reply.slice(-6000)
    }
    if (event.type !== 'turn/end') return
    turns.delete(id)
    if (event.data.reason?.kind !== 'completed') return
    const input = rememberableInput(turn.user, turn.assistant)
    const target = session.requestHeader?.()?.config ?? ctx.agents.get(id)?.options
    if (!input || !target?.provider || !target?.model) return
    store.enqueue({
      session: id, turn: event.data.turn, persona: turn.persona, workspace: session.header?.cwd ?? '',
      provider: target.provider, model: target.model, input,
    })
    queueMicrotask(drain)
  })
}
