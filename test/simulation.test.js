import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { createSimulation } from '../lib/simulation.js'
import { Store } from '../lib/store.js'

test('survey snapshots and isolates each role, bounds concurrency and retries only failures', async () => {
  const store = new Store(':memory:')
  const lifetime = new AbortController()
  let active = 0
  let peak = 0
  const seen = []
  const llm = { async *stream(request) {
    active++
    peak = Math.max(peak, active)
    try {
      const input = JSON.parse(request.messages.at(-1).content[0].text)
      const first = !seen.some(item => item.role.id === input.role.id)
      seen.push(input)
      await setTimeout(1)
      const response = input.role.id === 'r2' && first ? { choice: 'invalid' } : { choice: 'yes' }
      yield { type: 'text-delta', text: JSON.stringify(response) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      active--
    }
  } }
  const simulation = createSimulation(store, llm, lifetime.signal)
  const config = {
    title: 'Test', material: 'Original', provider: 'test', model: 'test',
    roles: Array.from({ length: 205 }, (_, index) => ({ id: 'r' + index, background: 'Only ' + index })),
    questions: [{ id: 'choice', text: 'Choice?', options: ['yes', 'no'] }, { id: 'comment', text: 'Why?' }],
  }
  async function settled(id) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const result = simulation.result(id)
      if (result.jobs.every(job => job.status === 'done' || job.status === 'failed')) return result.jobs
      await setTimeout(10)
    }
    assert.fail('survey did not settle')
  }
  try {
    const roster = simulation.batches.save({ title: 'Students', roles: config.roles })
    assert.equal(simulation.batches.list()[0].count, 205)
    assert.equal(simulation.batches.read(roster.id).roles.length, 205)
    const saved = simulation.questionnaires.save(config)
    assert.equal(simulation.questionnaires.read(saved.id).questions.length, 2)
    const { id } = simulation.start(config)
    simulation.batches.remove(roster.id)
    simulation.questionnaires.remove(saved.id)
    config.material = 'Edited after submission'
    const first = await settled(id)
    assert.equal(peak, 2)
    assert.equal(seen.length, 205)
    assert.equal(new Set(seen.map(item => item.role.id)).size, 205)
    assert.ok(seen.every(input => input.material === 'Original' && !Object.hasOwn(input, 'roles')))
    assert.equal(first.find(job => job.role === 'r2').status, 'failed')
    assert.deepEqual(simulation.retry(id, 'r0'), { queued: false })
    assert.deepEqual(simulation.retry(id, 'r2'), { queued: true })
    const retried = (await settled(id)).find(job => job.role === 'r2')
    assert.equal(seen.length, 206)
    assert.equal(retried.status, 'done')
    assert.deepEqual(retried.answers, [{ id: 'choice', answer: 'yes' }, { id: 'comment', answer: null }])
    const calibration = { id, cohort: null, source: 'Field survey', total: 32, rows: [{ id: 'choice', counts: [18, 12] }] }
    assert.deepEqual(simulation.calibrate(calibration), { saved: true })
    assert.throws(() => simulation.calibrate({ ...calibration, total: 29 }), /不能超过/)
    assert.throws(() => simulation.calibrate({ ...calibration, cohort: 'Unknown' }), /不属于/)
    assert.deepEqual(simulation.result(id).calibration, [{
      cohort: null, source: 'Field survey', total: 32, rows: [{ id: 'choice', counts: [18, 12] }],
    }])
  } finally {
    lifetime.abort()
    store.close()
  }
})
