import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Store, clean } from '../lib/store.js'
import { extract } from '../lib/extract.js'

const make = (tag, detail = tag + ' 第 29 行') => ({
  kind: 'progress', topic: tag, title: tag + ' 项目', summary: tag + ' 继续学习', detail,
})
const job = (session, persona, turn = 1) => ({
  session, persona, turn, workspace: 'demo', provider: 'mock', model: 'mock-1', input: '{}',
})
const save = (store, source, entry) => {
  store.enqueue(source)
  const claim = store.nextJob()
  assert.ok(claim)
  store.finish(claim, [entry])
}

test('parallel personas keep their own bindings, summary and index after reopen', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-continuity-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'memory.sqlite')
  let store = new Store(path)
  const a = store.savePersona('', '导师', '讲源码')
  const b = store.savePersona('', '导师', '讲论文')
  store.bind('a1', a)
  store.bind('b1', b)
  save(store, job('a1', a), make('ALPHA-1'))
  save(store, job('b1', b), make('BRAVO-2'))
  store.close()

  store = new Store(path)
  try {
    assert.equal(store.personaFor('a1').id, a)
    assert.equal(store.personaFor('b1').id, b)
    assert.equal(store.personaFor('plain'), undefined)
    assert.equal(store.savePersona(a, '源码导师', '新版设定'), a)
    store.bind('a2', a)
    assert.equal(store.personaFor('a1').instructions, '讲源码')
    assert.equal(store.personaFor('a1').name, '源码导师')
    assert.equal(store.personaFor('a2').instructions, '新版设定')
    assert.equal(store.savePersona(a, 'Soryu'), a)
    assert.equal(store.personas().find(persona => persona.id === a).instructions, '新版设定')
    assert.equal(store.personaFor('a2').name, 'Soryu')
    const opening = store.recall(store.personaFor('a2').id, 'other workspace', 'ALPHA-1', 'a2')
    assert.match(opening[0].summary, /ALPHA-1/)
    assert.equal(store.recall(a, 'demo', '项目 ALPHA-1 目前的进度是什么？', 'a2')[0].id, opening[0].id)
    assert.match(opening[0].detail, /第 29 行/)
    assert.deepEqual(store.search(b, 'demo', 'ALPHA-1'), [])
    assert.deepEqual(store.search(a, 'demo', 'ALPHA-99'), [])
    assert.equal(store.forget(b, opening[0].id), false)
    assert.equal(opening[0].session, 'a1')
    assert.equal(store.forget(a, opening[0].id), true)
    assert.deepEqual(store.recall(a, 'demo', 'ALPHA-1', 'a2'), [])
  } finally {
    store.close()
  }
})

test('queue persists, claims once per host and updates the same topic', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-continuity-lease-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'memory.sqlite')
  let first = new Store(path)
  const id = first.savePersona('', 'A', 'A')
  first.bind('a', id)
  first.enqueue(job('a', id))
  first.close()
  first = new Store(path)
  const second = new Store(path)
  try {
    const claim = first.nextJob()
    assert.ok(claim)
    assert.equal(second.nextJob(), undefined)
    first.finish({ ...claim, lease: 'wrong' }, [make('alpha', 'do not save')])
    assert.deepEqual(second.search(id, 'demo', 'alpha'), [])
    first.finish(claim, [make('alpha')])
    const original = second.search(id, 'demo', 'alpha')[0].id
    save(second, job('a', id, 2), make('alpha', '更新为第 40 行'))
    const rows = first.search(id, 'demo', 'alpha')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, original)
    assert.equal(rows[0].detail, '更新为第 40 行')
  } finally {
    first.close()
    second.close()
  }
})

test('continuation intent excludes this session and other personas', () => {
  const store = new Store(':memory:')
  try {
    const a = store.savePersona('', 'A', '')
    const b = store.savePersona('', 'B', '')
    store.bind('a1', a)
    store.bind('a2', a)
    store.bind('b1', b)
    save(store, job('a1', a), make('cross-session-memory', '上次验证了 SQLite'))
    save(store, job('a2', a), make('本轮任务'))
    save(store, job('b1', b), make('另一个人格'))
    const rows = store.recall(a, 'demo', '上一个 session 最近会话 进展', 'a2')
    assert.deepEqual(rows.map(row => [row.session, row.detail]), [['a1', '上次验证了 SQLite']])
    assert.deepEqual(store.recall(a, 'demo', '明天下雨吗', 'a2'), [])
    assert.deepEqual(store.recall(b, 'demo', '继续上次', 'b1'), [])
  } finally {
    store.close()
  }
})

test('retains useful text and filters credentials before extraction', () => {
  const input = clean('记住我的偏好，api_key=abcdefghijk，ghp_abcDefghijKLMN', 256)
  assert.match(input, /记住我的偏好/)
  assert.doesNotMatch(input, /abcdefghijk|ghp_/)
})

test('extraction accepts structured replies and rejects partial finishes', async () => {
  const data = { ...job('a', 'persona'), input: JSON.stringify({ user: '确认使用 sqlite', assistant: '测试回复' }) }
  const success = { async *stream(options) {
    assert.equal(options.provider, 'mock')
    assert.equal(options.messages[0].role, 'system')
    assert.equal(options.messages[0].content[0].type, 'text')
    yield { type: 'text-delta', text: JSON.stringify([{ ...make('sqlite'), evidence: '确认使用 sqlite' }, { ...make('unfounded'), evidence: '没有原文支持的事实' }]) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const entries = await extract(success, data, [], new AbortController().signal)
  assert.deepEqual(entries.map(item => item.topic), ['sqlite'])
  const failed = { async *stream() {
    yield { type: 'text-delta', text: '[]' }
    yield { type: 'finish', reason: { kind: 'error' } }
  } }
  await assert.rejects(extract(failed, data, [], new AbortController().signal), /did not finish/)
})
