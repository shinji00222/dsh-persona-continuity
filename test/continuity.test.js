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
    assert.equal(store.savePersona(a, '源码导师', '讲源码'), a)
    store.bind('a2', a)
    const opening = store.summary(store.personaFor('a2').id, 'demo')
    assert.match(opening[0].summary, /ALPHA-1/)
    assert.equal('detail' in opening[0], false)
    assert.deepEqual(store.search(b, 'demo', 'ALPHA-1'), [])
    assert.deepEqual(store.search(a, 'demo', 'ALPHA-99'), [])
    assert.equal(store.detail(b, opening[0].id), undefined)
    const memory = store.detail(a, opening[0].id)
    assert.match(memory.detail, /第 29 行/)
    assert.equal(memory.session, 'a1')
    assert.equal(store.forget(a, opening[0].id), true)
    assert.deepEqual(store.summary(a, 'demo'), [])
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
  first.enqueue(job('a', id))
  first.close()
  first = new Store(path)
  const second = new Store(path)
  try {
    const claim = first.nextJob()
    assert.ok(claim)
    assert.equal(second.nextJob(), undefined)
    first.finish({ ...claim, lease: 'wrong' }, [make('alpha', 'do not save')])
    assert.deepEqual(second.summary(id, 'demo'), [])
    first.finish(claim, [make('alpha')])
    const original = second.summary(id, 'demo')[0].id
    save(second, job('a', id, 2), make('alpha', '更新为第 40 行'))
    assert.equal(first.summary(id, 'demo').length, 1)
    assert.equal(first.detail(id, original).detail, '更新为第 40 行')
  } finally {
    first.close()
    second.close()
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
