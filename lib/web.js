const route = '/api/persona-continuity'
const responseHeaders = { 'cache-control': 'no-store' }

function str(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

async function bodyOf(request, limit) {
  const text = await request.text()
  if (Buffer.byteLength(text) > limit) throw new Error('请求过长')
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式错误')
  return value
}

export function registerWeb(connection, api, simulation) {
  function register(path, method, action, limit = 12000) {
    return connection.fetch.register({
      path: route + path,
      methods: [method],
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const input = method === 'POST' ? await bodyOf(request, limit) : new URL(request.url).searchParams
          return Response.json(await action(input), { headers: responseHeaders })
        } catch (error) {
          const message = error instanceof SyntaxError ? '请求格式错误' : error.message
          return Response.json({ error: message }, { status: 400, headers: responseHeaders })
        }
      },
    })
  }
  const dispose = [
    register('/state', 'GET', query => api.state(str(query.get('session')))),
    register('/index', 'GET', query => api.list(str(query.get('persona')), str(query.get('q'), 300))),
    register('/bind', 'POST', body => api.bind(str(body.session), str(body.persona))),
    register('/create', 'POST', body => api.create(str(body.session), str(body.name))),
    register('/persona', 'POST', body => {
      const id = str(body.id)
      const instructions = id && body.instructions === undefined ? undefined : str(body.instructions, 3500)
      return { id: api.save(id, str(body.name), instructions) }
    }),
    register('/edit', 'POST', body => {
      api.edit(str(body.persona), str(body.id), body.edits)
      return { saved: true }
    }),
    register('/forget', 'POST', body => ({ removed: api.forget(str(body.persona), str(body.id)) })),
    register('/simulation/models', 'GET', () => simulation.models()),
    register('/simulation/runs', 'GET', () => simulation.list()),
    register('/simulation/run', 'POST', input => simulation.start(input), 4000000),
    register('/simulation/result', 'GET', query => simulation.result(str(query.get('id')))),
    register('/simulation/retry', 'POST', body => simulation.retry(str(body.id), str(body.role))),
    register('/simulation/calibration', 'POST', body => simulation.calibrate({ ...body, id: str(body.id) }), 25000),
  ]
  for (const [path, library, bytes] of [
    ['/simulation/batches', simulation.batches, 4000000],
    ['/simulation/questionnaires', simulation.questionnaires, 200000],
  ]) {
    dispose.push(
      register(path, 'GET', () => library.list()),
      register(path + '/item', 'GET', query => library.read(str(query.get('id')))),
      register(path + '/save', 'POST', body => library.save({ ...body, id: str(body.id) }), bytes),
      register(path + '/remove', 'POST', body => library.remove(str(body.id))),
    )
  }
  return () => Promise.all(dispose.map(unregister => unregister()))
}
