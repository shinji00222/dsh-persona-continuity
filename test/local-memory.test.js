import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { extract, reviewMemories } from '../lib/extract.js'
import { recentMemorySources } from '../lib/history.js'
import { Store } from '../lib/store.js'

const input = {
  kind: 'decision', topic: 'platform', title: '平台决定', summary: '首版只做 Windows',
  detail: '发布仅覆盖 Windows 桌面。', evidence: '首版只做 Windows',
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'persona-markdown-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, db: join(root, 'persona-memory-sim', 'memory.sqlite'),
    memory: join(root, 'persona-continuity', 'memories') }
}

function job(session, persona, turn = 1) {
  return { session, persona, turn, workspace: 'workspace', provider: 'mock', model: 'mock', input: '{}' }
}

test('runtime writes an independent Markdown directory and prevents replay after forget', t => {
  const { db, memory } = fixture(t)
  const store = new Store(db)
  const a = store.savePersona('', '同名', '负责研究')
  const b = store.savePersona('', '同名', '负责代码')
  store.bind('a', a)
  store.bind('b', b)
  store.enqueue(job('a', a))
  const lease = store.nextJob()
  store.finish(lease, [input])
  const note = store.search(a, '', '')[0]
  const dir = join(memory, a)
  assert.deepEqual(readdirSync(dir).sort(), ['MEMORY.md', 'notes'])
  assert.match(readFileSync(join(dir, 'notes', note.id + '.md'), 'utf8'), /发布仅覆盖 Windows/)
  assert.match(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), /平台决定/)
  assert.equal(existsSync(join(memory, b)), false)
  assert.equal(store.detail(a, note.id, 'other-workspace'), undefined)
  assert.equal(store.detail(b, note.id), undefined)
  assert.equal(store.detail(a, '../outside'), undefined)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM memories').get().count, 0)
  store.savePersona(a, '改名')
  assert.equal(store.detail(a, note.id).id, note.id)
  store.edit(a, note.id, { ...note, detail: '人工修正', revision: note.revision })
  assert.throws(() => store.edit(a, note.id, note), /记忆已更新/)
  assert.equal(store.forget(a, note.id, store.detail(a, note.id).revision), true)
  store.close()
  const reopened = new Store(db)
  try {
    reopened.enqueue(job('a', a, 2))
    reopened.finish(reopened.nextJob(), [input])
    assert.deepEqual(reopened.search(a, '', ''), [])
    assert.doesNotMatch(readFileSync(join(dir, 'notes', note.id + '.md'), 'utf8'), /人工修正|发布仅覆盖/)
  } finally { reopened.close() }
})

test('disabling automatic memory discards queued and active work while keeping saved notes', t => {
  const { db } = fixture(t)
  const store = new Store(db)
  try {
    const persona = store.savePersona('', '研究顾问', '')
    store.bind('a', persona)
    store.enqueue(job('a', persona))
    store.finish(store.nextJob(), [input])
    store.enqueue(job('a', persona, 2))
    const running = store.nextJob()
    store.setAutoMemory(persona, false)
    assert.equal(store.personas()[0].autoMemory, false)
    assert.equal(store.enqueue(job('a', persona, 3)), false)
    store.setAutoMemory(persona, true)
    store.finish(running, [{ ...input, topic: 'too-late' }])
    assert.deepEqual(store.search(persona, '', '').map(note => note.topic), ['platform'])
  } finally { store.close() }
})

test('file journal replays exact decisions after a partial write', t => {
  const { db } = fixture(t)
  let store = new Store(db)
  const persona = store.savePersona('', '研究顾问', '')
  store.bind('a', persona)
  store.enqueue(job('a', persona))
  const claim = store.nextJob()
  const write = store.memory.write.bind(store.memory)
  store.memory.write = (id, note) => {
    if (note.topic === 'second') throw new Error('simulated interrupted write')
    write(id, note)
  }
  const items = [input, { ...input, topic: 'second' }]
  assert.throws(() => store.finish(claim, items), /interrupted/)
  const first = store.search(persona, '', '')[0]
  store.close()
  store = new Store(db)
  try {
    assert.deepEqual(store.preparedItems(claim), items)
    store.finish(claim, [{ ...input, topic: 'different-result' }])
    const rows = store.search(persona, '', '')
    assert.deepEqual(rows.map(note => note.topic).sort(), ['platform', 'second'])
    assert.equal(rows.find(note => note.id === first.id).revision, first.revision)
    assert.equal(store.preparedItems(claim), undefined)
  } finally { store.close() }
})

test('refuses a persona directory that points outside the memory root', t => {
  const { db, memory, root } = fixture(t)
  const outside = join(root, 'outside')
  mkdirSync(outside)
  mkdirSync(memory, { recursive: true })
  const store = new Store(db)
  try {
    const persona = store.savePersona('', '研究顾问', '')
    symlinkSync(outside, join(memory, persona), process.platform === 'win32' ? 'junction' : 'dir')
    store.bind('a', persona)
    store.enqueue(job('a', persona))
    assert.throws(() => store.finish(store.nextJob(), [input]), /记忆目录不可用/)
    assert.deepEqual(readdirSync(outside), [])
  } finally { store.close() }
})

test('the model receives the persona and can decide to save or skip the same turn', async () => {
  const signal = new AbortController().signal
  const calls = []
  const llm = { async *stream(options) {
    const request = JSON.parse(options.messages[1].content[0].text)
    calls.push(request.persona.instructions)
    yield { type: 'text-delta', text: JSON.stringify(request.persona.instructions === '研究' ? [input] : []) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const request = { ...job('a', 'test'), input: JSON.stringify({ user: '首版只做 Windows', assistant: '收到' }) }
  assert.equal((await extract(llm, { ...request, memoryPersona: { instructions: '研究' } }, [], signal)).length, 1)
  assert.deepEqual(await extract(llm, { ...request, memoryPersona: { instructions: '写作' } }, [], signal), [])
  assert.deepEqual(calls, ['研究', '写作'])
})

test('review accepts a correction from a later bound turn and rejects an older source', async () => {
  const signal = new AbortController().signal
  const headers = [
    { id: 'foreign', cwd: 'here', createdAt: 300 },
    { id: 'other-workspace', cwd: 'elsewhere', createdAt: 300 },
    { id: 'new-chat', cwd: 'here', createdAt: 300 },
  ]
  const observations = []
  const evidence = '首版同时做 Windows 和 macOS'
  const service = {
    async filterSessions() { return headers.map(header => ({ header })) },
    async observeSession(id) {
      observations.push(id)
      return { header: headers.find(header => header.id === id), events: [
        { type: 'user/message', data: { source: { kind: 'user' }, content: evidence } },
        { type: 'turn/end', data: { turn: 5, reason: { kind: 'completed' } } },
      ], [Symbol.dispose]() {} }
    },
  }
  const sources = await recentMemorySources(service, { id: 'active', cwd: 'here' },
    new Set(['other-workspace', 'new-chat']), signal)
  assert.deepEqual(observations, ['new-chat'])
  assert.deepEqual(sources.map(({ session, turn }) => [session, turn]), [['new-chat', 5]])
  const llm = { async *stream() {
    yield { type: 'text-delta', text: JSON.stringify([
      { id: 'note', title: '首版平台', summary: evidence, detail: evidence, sourceIndex: 0, evidence },
    ]) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const options = { target: { provider: 'mock', model: 'mock' }, sessionId: 'active', persona: {}, sources }
  const note = { id: 'note', session: 'old-chat', turn: 1, updated: 100 }
  assert.equal((await reviewMemories(llm, { ...options, notes: [note] }, signal))[0].source.session, 'new-chat')
  assert.deepEqual(await reviewMemories(llm, { ...options, notes: [{ ...note, updated: 400 }] }, signal), [])
})
