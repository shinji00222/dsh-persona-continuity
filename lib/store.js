import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const LIMIT = 1000
const kinds = new Set(['preference', 'decision', 'progress', 'lesson', 'fact'])

function tokens(text) {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu) ?? []
  const result = new Set()
  for (const word of words) {
    if (/\p{Script=Han}/u.test(word)) {
      for (let i = 1; i < word.length; i++) result.add(word.slice(i - 1, i + 1))
      if (word.length === 1) result.add(word)
    } else if (word.length > 1) result.add(word)
  }
  return result
}

export function clean(value, max) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g, '[redacted]')
    .replace(/\b(?:bearer\s+[\w.+/=-]{8,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[\w.+/=-]{8,})/gi, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim().slice(0, max)
}

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
      const version = this.db.prepare('PRAGMA user_version').get().user_version
      if (version > 2) throw new Error('记忆库版本高于当前插件支持的版本')
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS bindings (session TEXT PRIMARY KEY, persona TEXT NOT NULL REFERENCES personas(id));' +
        'CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, persona TEXT NOT NULL REFERENCES personas(id), ' +
        'topic TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL, ' +
        'session TEXT NOT NULL, turn INTEGER NOT NULL, workspace TEXT NOT NULL, updated INTEGER NOT NULL, ' +
        'UNIQUE(persona, kind, topic, workspace));' +
        'CREATE INDEX IF NOT EXISTS memories_recent ON memories(persona, updated DESC);' +
        'CREATE TABLE IF NOT EXISTS jobs (session TEXT NOT NULL, turn INTEGER NOT NULL, persona TEXT NOT NULL REFERENCES personas(id), ' +
        'workspace TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input TEXT NOT NULL, ' +
        'attempt INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL, PRIMARY KEY(session, turn));',
      )
      if (version < 2) this.transaction(() => {
        this.db.exec('ALTER TABLE jobs ADD COLUMN created INTEGER NOT NULL DEFAULT 0; ' +
          'ALTER TABLE jobs ADD COLUMN lease TEXT; UPDATE jobs SET created = available; PRAGMA user_version = 2')
      })
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close() { this.db.close() }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  personas() {
    return this.db.prepare('SELECT id, name, instructions FROM personas ORDER BY name, id').all()
  }

  savePersona(id, name, instructions) {
    name = clean(name, 48)
    instructions = clean(instructions, 3500)
    if (!name) throw new Error('请填写人格名称')
    if (id) {
      const result = this.db.prepare('UPDATE personas SET name = ?, instructions = ? WHERE id = ?')
        .run(name, instructions, id)
      if (!result.changes) throw new Error('人格不存在')
      return id
    }
    id = randomUUID()
    this.db.prepare('INSERT INTO personas VALUES (?, ?, ?)').run(id, name, instructions)
    return id
  }

  personaFor(session) {
    return this.db.prepare('SELECT p.* FROM bindings b JOIN personas p ON p.id = b.persona WHERE b.session = ?').get(session)
  }

  bind(session, persona) {
    if (persona === '') {
      this.db.prepare('DELETE FROM bindings WHERE session = ?').run(session)
      return
    }
    if (!this.db.prepare('SELECT 1 FROM personas WHERE id = ?').get(persona)) throw new Error('人格不存在')
    this.db.prepare('INSERT INTO bindings VALUES (?, ?) ON CONFLICT(session) DO UPDATE SET persona = excluded.persona')
      .run(session, persona)
  }

  enqueue(job) {
    const now = Date.now()
    this.db.prepare('INSERT OR IGNORE INTO jobs (session, turn, persona, workspace, provider, model, input, available, created) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(job.session, job.turn, job.persona, job.workspace,
      job.provider, job.model, job.input, now, now)
  }

  nextJob() {
    return this.transaction(() => {
      const now = Date.now()
      const job = this.db.prepare('SELECT * FROM jobs WHERE available <= ? ORDER BY available, session, turn LIMIT 1').get(now)
      if (!job) return undefined
      const lease = randomUUID()
      this.db.prepare('UPDATE jobs SET lease = ?, available = ? WHERE session = ? AND turn = ?')
        .run(lease, now + 60000, job.session, job.turn)
      return { ...job, lease }
    })
  }

  fail(job) {
    if (job.attempt >= 2) {
      this.db.prepare('DELETE FROM jobs WHERE session = ? AND turn = ? AND lease = ?').run(job.session, job.turn, job.lease)
      return
    }
    this.db.prepare('UPDATE jobs SET attempt = attempt + 1, lease = NULL, available = ? WHERE session = ? AND turn = ? AND lease = ?')
      .run(Date.now() + (job.attempt + 1) * 15000, job.session, job.turn, job.lease)
  }

  finish(job, items) {
    this.transaction(() => {
      const accepted = this.db.prepare('DELETE FROM jobs WHERE session = ? AND turn = ? AND lease = ?')
        .run(job.session, job.turn, job.lease)
      if (!accepted.changes) return
      const put = this.db.prepare(
        'INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(persona, kind, topic, workspace) DO UPDATE SET title = excluded.title, summary = excluded.summary, ' +
        'detail = excluded.detail, session = excluded.session, turn = excluded.turn, updated = excluded.updated ' +
        'WHERE memories.updated <= excluded.updated',
      )
      for (const item of items.slice(0, 4)) {
        if (!item || typeof item !== 'object' || !kinds.has(item.kind)) continue
        const title = clean(item.title, 90).replace(/\s+/g, ' ')
        const topic = clean(item.topic, 100).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
        const summary = clean(item.summary, 160).replace(/\s+/g, ' ')
        const detail = clean(item.detail, 1800)
        if (!title || !topic || !summary || !detail) continue
        const workspace = item.kind === 'preference' ? '' : job.workspace
        put.run(randomUUID(), job.persona, topic, item.kind, title, summary, detail,
          job.session, job.turn, workspace, job.created)
      }
    })
  }

  topics(persona, workspace) {
    return this.db.prepare('SELECT kind, topic, title, summary FROM memories WHERE persona = ? ' +
      "AND (workspace = ? OR workspace = '') ORDER BY updated DESC LIMIT 12").all(persona, workspace)
  }

  summary(persona, workspace) {
    const rows = this.db.prepare(
      'SELECT id, kind, title, summary FROM memories WHERE persona = ? ' +
      'ORDER BY (workspace = ?) DESC, updated DESC, id LIMIT 6',
    ).all(persona, workspace)
    return rows.map(row => ({ id: row.id, kind: row.kind, title: row.title, summary: row.summary }))
  }

  search(persona, workspace, query = '') {
    const needle = clean(query, 300).normalize('NFKC').toLowerCase()
    const terms = tokens(needle)
    const numbers = needle.match(/\d+/g) ?? []
    const rows = this.db.prepare(
      'SELECT id, kind, title, summary, detail, session, turn, workspace, updated FROM memories WHERE persona = ? ' +
      'ORDER BY updated DESC, id LIMIT ?',
    ).all(persona, LIMIT)
    if (!needle) return rows.sort((a, b) => Number(b.workspace === workspace) - Number(a.workspace === workspace)).slice(0, 8)
    return rows.map(row => {
      const value = [row.title, row.summary, row.detail].join(' ').normalize('NFKC').toLowerCase()
      const valueNumbers = new Set(value.match(/\d+/g) ?? [])
      if (numbers.some(number => !valueNumbers.has(number))) return { row, score: 0 }
      const indexed = tokens(value)
      let overlap = 0
      for (const term of terms) if (indexed.has(term)) overlap++
      const score = value.includes(needle) ? 4 : overlap / Math.max(1, terms.size)
      return { row, score }
    }).filter(result => result.score >= 0.34)
      .sort((a, b) => b.score - a.score || Number(b.row.workspace === workspace) - Number(a.row.workspace === workspace))
      .slice(0, 8).map(result => result.row)
  }

  detail(persona, id) {
    return this.db.prepare('SELECT id, kind, title, summary, detail, session, turn, workspace, updated ' +
      'FROM memories WHERE persona = ? AND id = ?').get(persona, id)
  }

  forget(persona, id) {
    return this.db.prepare('DELETE FROM memories WHERE persona = ? AND id = ?').run(persona, id).changes > 0
  }
}
