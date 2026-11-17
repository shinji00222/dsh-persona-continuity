import assert from 'node:assert/strict'
import { test } from 'node:test'
import { historyRequest, retrieveHistory } from '../lib/history.js'

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
