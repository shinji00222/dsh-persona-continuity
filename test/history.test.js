import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  historyRequest,
  listSessionsForImport,
  packConversationChunks,
  readConversationChunks,
  retrieveHistory,
} from '../lib/history.js'

test('recognizes general history references without taking over routine memory requests', () => {
  assert.deepEqual(historyRequest('读上上上个对话'), { offset: 3 })
  assert.deepEqual(historyRequest('看一下往前第十一段会话'), { offset: 11 })
  assert.deepEqual(historyRequest('查一下倒数第27个对话'), { offset: 27 })
  assert.deepEqual(historyRequest('找之前聊 SQLite 的那段'), { query: 'SQLite' })
  assert.deepEqual(historyRequest('查历史对话：模型配置'), { query: '模型配置' })
  assert.equal(historyRequest('继续上次'), undefined)
  assert.equal(historyRequest('记住这次聊了 SQLite'), undefined)
})

test('history scopes IDs before reading and excludes tools, runtime context and interrupted messages', async () => {
  const caller = { id: 'current', cwd: 'workspace', createdAt: 500 }
  const trusted = { id: 'old', cwd: 'workspace', createdAt: 100 }
  const allowed = new Set([trusted.id, caller.id])
  let reads = 0
  let disposed = false
  const service = {
    async filterSessions(filters) {
      assert.deepEqual(filters[0].values, [trusted.id, caller.id])
      return [{ header: caller }, { header: trusted }, { header: { ...trusted, id: 'foreign' } }]
    },
    async observeSession(id) {
      assert.equal(id, trusted.id)
      reads++
      return { header: trusted, [Symbol.dispose]() { disposed = true }, events: [
        { type: 'user/message', seq: 1, data: { source: { kind: 'runtime-context' }, content: 'not human' } },
        { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: 'original' } },
        { type: 'tool/result', seq: 3, data: { content: 'tool output' } },
        { type: 'assistant/message', seq: 4, data: { interrupted: true, message: { content: 'partial' } } },
        { type: 'assistant/message', seq: 5, data: { message: { content: 'answer' } } },
      ] }
    },
  }
  const signal = new AbortController().signal
  assert.deepEqual(await retrieveHistory(service, caller, allowed, { id: 'foreign' }, signal), { status: 'not-found' })
  assert.equal(reads, 0)
  const result = await retrieveHistory(service, caller, allowed, { offset: 1 }, signal)
  assert.equal(disposed, true)
  assert.equal(result.source.id, trusted.id)
  assert.deepEqual(result.excerpts.map(item => item.text), ['original', 'answer'])
})

test('packConversationChunks merges short turns into one chunk and splits long chats', () => {
  const short = packConversationChunks([
    { role: 'user', text: '先确认使用 SQLite' },
    { role: 'assistant', text: '好的，已经记下使用 SQLite。' },
    { role: 'user', text: '端口用 3000' },
    { role: 'assistant', text: '明白，端口保持 3000。' },
  ])
  assert.equal(short.length, 1)
  assert.equal(short[0].turn, 1)
  assert.match(short[0].user, /SQLite[\s\S]*3000/)

  const long = packConversationChunks([
    { role: 'user', text: 'A'.repeat(30) },
    { role: 'assistant', text: 'B'.repeat(30) },
    { role: 'user', text: 'C'.repeat(30) },
    { role: 'assistant', text: 'D'.repeat(30) },
  ], { maxSide: 40, maxMessage: 100 })
  assert.equal(long.length, 2)
  assert.equal(long[0].turn, 1)
  assert.equal(long[1].turn, 2)
})

test('listSessionsForImport and readConversationChunks filter unsupported sessions and extract clean turns', async () => {
  let disposed = false
  const service = {
    async filterSessions() {
      return [
        { header: { id: 's-old', cwd: 'w', createdAt: 100 } },
        { header: { id: 's-new', cwd: 'w', createdAt: 200 } },
        { header: { id: 's-sub', cwd: 'w', createdAt: 300, parentSession: 's-new' } },
        { header: { id: 'session-incognito-1', cwd: 'w', createdAt: 400 } },
      ]
    },
    async readTitleSnapshots() {
      return [
        { status: 'fulfilled', value: { session: { id: 's-old' }, title: { title: '旧讨论' } } },
        { status: 'fulfilled', value: { session: { id: 's-new' }, title: { title: '' } } },
      ]
    },
    async observeSession(id) {
      assert.equal(id, 's-old')
      return {
        header: { id: 's-old', cwd: 'w' },
        [Symbol.dispose]() { disposed = true },
        events: [
          { type: 'user/message', data: { source: { kind: 'runtime-context' }, content: 'ignore' } },
          { type: 'user/message', data: { source: { kind: 'user' }, content: '记住我们用 Node 22' } },
          { type: 'assistant/message', data: { interrupted: true, message: { content: 'half' } } },
          { type: 'assistant/message', data: { message: { content: '好的，Node 22。' } } },
        ],
      }
    },
  }
  const signal = new AbortController().signal
  const bindings = new Map([['s-old', { persona: 'p1', name: '导师' }]])
  const listed = await listSessionsForImport(service, bindings, signal)
  assert.deepEqual(listed.map(item => [item.id, item.title, item.personaName]), [
    ['s-new', '未命名会话', ''],
    ['s-old', '旧讨论', '导师'],
  ])
  const read = await readConversationChunks(service, 's-old', signal)
  assert.equal(disposed, true)
  assert.equal(read.workspace, 'w')
  assert.equal(read.chunks.length, 1)
  assert.equal(read.chunks[0].user, '记住我们用 Node 22')
  assert.equal(read.chunks[0].assistant, '好的，Node 22。')
})
