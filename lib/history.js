import { clean } from './store.js'
import { textBlocks } from './extract.js'

const historyNoun = '(?:对话|会话|聊天|聊天记录|session|chat)'
const retrieval = /读|查|找|搜|看|回顾|回忆|总结|还原|打开|说了什么|聊了什么|\b(?:read|find|search|show|open|summarize|recap)\b/iu
const historyHint = new RegExp('(?:历史|之前|以前|旧|过去|之前的|前面|上次|上上*|前一个|倒数第|往前第|原文|那段|那次|曾经)|\\b(?:previous|earlier|last|older|prior|past|history|transcript)\\b', 'iu')
const digits = '零一二三四五六七八九'

function positiveNumber(text) {
  if (/^\d+$/.test(text)) {
    const number = Number(text)
    return Number.isSafeInteger(number) && number > 0 ? number : undefined
  }
  const normalized = text.replace(/两/g, '二')
  const position = normalized.indexOf('十')
  const value = position < 0
    ? digits.indexOf(normalized)
    : (position === 0 ? 1 : digits.indexOf(normalized[0])) * 10 +
      (position === normalized.length - 1 ? 0 : digits.indexOf(normalized.at(-1)))
  return value > 0 ? value : undefined
}

export function historyRequest(input) {
  const text = typeof input === 'string' ? input.trim().slice(0, 1800) : ''
  if (!text) return undefined
  const explicit = text.match(/^(?:请)?(?:搜|查|找)(?:找|看|阅|询|索)?(?:旧|历史)?(?:对话|会话|聊天(?:记录)?)\s*[:：]\s*(.+)$/isu)
  const id = text.match(/\bsession-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/iu)?.[0]
  const shortRelative = text.match(/^(?:(?:请|帮我)?(?:读|查|看)(?:一下)?\s*)(上+)\s*(?:一)?[个段次条][吧。！？!？?]*$/u)
  if (shortRelative) return { offset: shortRelative[1].length }
  const pastTopic = /(?:之前|过去|以前|历史).{0,60}(?:聊|讨论|提到).{1,100}那(?:段|个|次)/su.test(text)
  if (!explicit && (!retrieval.test(text) ||
    (!id && !pastTopic && (!new RegExp(historyNoun, 'iu').test(text) || !historyHint.test(text))))) return undefined
  if (id) return { id: id.toLowerCase() }

  const ordinal = text.match(/(?:倒数|往前|前面)(?:的)?第\s*([\d零一二两三四五六七八九十]+)\s*[个段条次]?/u)
  if (ordinal) {
    const offset = positiveNumber(ordinal[1])
    if (offset) return { offset }
  }
  const relative = text.match(new RegExp('(上+)\\s*(?:(?:一)?[个段条次])?\\s*(?:的)?(?:历史)?\\s*' + historyNoun, 'iu'))
  if (relative) return { offset: relative[1].length }
  if (/(?:前一个|刚才那[段个次]|前次).{0,8}(?:对话|会话|聊天)|\b(?:previous|last)\s+(?:session|chat|conversation)\b/iu.test(text)) {
    return { offset: 1 }
  }

  const quoted = text.match(/[「“『"]([^」”』"]{1,180})[」”』"]/u)?.[1]
  const topic = text.match(/(?:聊过|聊到|聊的|讨论过|讨论|提到过|提到|关于|标题是|标题为|叫做|叫作|名为|聊)\s*(.+?)(?=\s*(?:的那[段个次]|那[段个次]|的[旧历史]*[对会]话|的聊天记录|[，。！？!?]|$))/u)?.[1]
  const query = clean(explicit?.[1] ?? quoted ?? topic ?? '', 180)
  return query ? { query } : { missingQuery: true }
}

function permitted(header, caller, allowed) {
  return header.id !== caller.id && header.cwd === caller.cwd && allowed.has(header.id) &&
    !header.origin && !header.parentSession && !header.id.startsWith('session-incognito-')
}

function extractMessages(observation, matchSeq) {
  const messages = []
  for (const event of observation.events.slice(observation.inheritedEventCount ?? 0)) {
    const { type, data, seq } = event
    const user = type === 'user/message' && data.source?.kind === 'user'
    const assistant = type === 'assistant/message' && !data.interrupted
    if (!user && !assistant) continue
    const text = clean(textBlocks(user ? data.content : data.message?.content), 1600)
    if (text) messages.push({ seq, role: user ? 'user' : 'assistant', text })
  }
  const hit = matchSeq === undefined ? -1 : messages.findIndex(message => message.seq === matchSeq)
  const start = hit < 0 ? Math.max(0, messages.length - 8) : Math.max(0, hit - 2)
  let budget = 5400
  const excerpts = []
  for (const message of messages.slice(start, start + (hit < 0 ? 8 : 6))) {
    if (!budget) break
    const text = message.text.slice(0, budget)
    budget -= text.length
    excerpts.push({ ...message, text })
  }
  return excerpts
}

const sourceInfo = (header, title) => ({
  id: header.id, title: clean(title, 140) || '未命名会话', time: new Date(header.createdAt).toISOString(),
})

async function readConversation(service, id, caller, allowed, signal, title, matchSeq) {
  const observation = await service.observeSession(id, { signal, projectionMode: 'none' })
  try {
    if (!permitted(observation.header, caller, allowed)) return undefined
    const excerpts = extractMessages(observation, matchSeq)
    if (!excerpts.length) return undefined
    const latestTitle = title || observation.events.findLast(event => event.type === 'session/title')?.data.title
    return { status: 'found', source: sourceInfo(observation.header, latestTitle), excerpts }
  } finally {
    observation[Symbol.dispose]()
  }
}

async function searchContents(service, records, query, signal) {
  const filters = [
    { kind: 'type', values: ['user/message', 'assistant/message'] },
    { kind: 'text', text: query },
  ]
  const hits = []
  for (let index = 0; index < records.length && hits.length < 3; index += 4) {
    signal.throwIfAborted()
    const batch = records.slice(index, index + 4)
    const abort = Promise.withResolvers()
    const stop = () => abort.reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    let settled
    try {
      settled = await Promise.race([
        Promise.allSettled(batch.map(record => service.filterEvents(record.header.id, filters))),
        abort.promise,
      ])
    } finally {
      signal.removeEventListener('abort', stop)
    }
    for (const [offset, result] of settled.entries()) {
      const hit = result.status === 'fulfilled' ? result.value.at(-1) : undefined
      if (hit) hits.push({ ...batch[offset], bestMatch: hit })
    }
  }
  signal.throwIfAborted()
  return hits
}

export async function retrieveHistory(service, caller, allowed, intent, signal) {
  if (intent.missingQuery) return { status: 'needs-query' }
  if (!caller.cwd || !allowed.size) return { status: 'not-found' }
  if (intent.id && !allowed.has(intent.id)) return { status: 'not-found' }
  const filters = [
    { kind: 'id', values: intent.id ? [intent.id] : [...allowed] },
    { kind: 'cwd', values: [caller.cwd] },
    { kind: 'parent', values: [null] },
  ]
  const matches = (await service.filterSessions(filters, signal))
    .filter(record => permitted(record.header, caller, allowed))
  if (!matches.length) return { status: 'not-found' }
  if (intent.query) {
    const recent = matches.slice(0, 24)
    const titles = await service.readTitleSnapshots(recent.map(record => record.header.id), signal)
    const byId = new Map()
    for (const result of titles) {
      if (result.status === 'fulfilled' && permitted(result.value.session, caller, allowed)) {
        byId.set(result.value.session.id, result.value.title?.title ?? '')
      }
    }
    const needle = intent.query.normalize('NFKC').toLowerCase()
    const titleMatches = recent.filter(({ header }) => byId.get(header.id)?.normalize('NFKC').toLowerCase().includes(needle))
    const exactTitles = titleMatches.filter(({ header }) => byId.get(header.id).normalize('NFKC').toLowerCase() === needle)
    const eventMatches = exactTitles.length ? [] : await searchContents(service, recent, intent.query, signal)
    const candidates = exactTitles.length ? exactTitles : [...new Map(
      [...titleMatches, ...eventMatches].map(record => [record.header.id, record]),
    ).values()]
    if (!candidates.length) return { status: 'not-found' }
    if (candidates.length > 1) {
      const top = candidates.slice(0, 3)
      return {
        status: 'ambiguous',
        choices: top.map(({ header }) => sourceInfo(header, byId.get(header.id))),
      }
    }
    const id = candidates[0].header.id
    const matchSeq = eventMatches.find(record => record.header.id === id)?.bestMatch.seq
    return await readConversation(service, id, caller, allowed, signal, byId.get(id), matchSeq) ?? { status: 'not-found' }
  }
  const earlier = intent.id ? matches : matches.filter(record => record.header.createdAt <= caller.createdAt)
  if (earlier.length < (intent.offset ?? 1)) return { status: 'not-found' }
  let offset = intent.offset ?? 1
  for (const { header } of earlier) {
    const result = await readConversation(service, header.id, caller, allowed, signal)
    if (result && --offset === 0) return result
  }
  return { status: 'not-found' }
}
