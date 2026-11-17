const route = '/api/persona-continuity'
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const hosts = new Set(['localhost', '127.0.0.1', '[::1]'])

function allowed(req) {
  if (req.headers['x-dsh-persona-continuity'] !== '1' || !loopback.has(req.socket.remoteAddress)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  try {
    const host = new URL('http://' + req.headers.host)
    if (!hosts.has(host.hostname) || host.username || host.password) return false
    const origin = req.headers.origin
    return !origin || origin === 'dsh-app://app' || new URL(origin).host === host.host
  } catch {
    return false
  }
}

async function bodyOf(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 12000) throw new Error('请求过长')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式错误')
  return value
}

function str(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function send(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

export function registerWeb(webServer, api) {
  return webServer.register({
    kind: 'prefix',
    path: route,
    async handler(req, res) {
      if (!allowed(req)) return send(res, 403, { error: '无权访问人格记忆' })
      try {
        const url = new URL(req.url, 'http://localhost')
        const action = url.pathname.slice(route.length)
        if (req.method === 'GET' && action === '/state') return send(res, 200, api.state(str(url.searchParams.get('session'))))
        if (req.method === 'GET' && action === '/index') {
          return send(res, 200, api.list(str(url.searchParams.get('persona')), str(url.searchParams.get('q'), 300)))
        }
        if (req.method !== 'POST') return send(res, 404, { error: '操作不存在' })
        if (!['/bind', '/persona', '/forget'].includes(action)) return send(res, 404, { error: '操作不存在' })
        const body = await bodyOf(req)
        if (action === '/bind') return send(res, 200, api.bind(str(body.session), str(body.persona)))
        if (action === '/persona') {
          return send(res, 200, { id: api.save(str(body.id), str(body.name), str(body.instructions, 3500)) })
        }
        return send(res, 200, { removed: api.forget(str(body.persona), str(body.id)) })
      } catch (error) {
        send(res, 400, { error: error instanceof SyntaxError ? '请求格式错误' : error.message })
      }
    },
  })
}
