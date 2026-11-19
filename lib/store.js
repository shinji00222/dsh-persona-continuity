import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const LIMIT = 5000
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

function memoryText(value) {
  const title = clean(value?.title, 90).replace(/\s+/g, ' ')
  const summary = clean(value?.summary, 160).replace(/\s+/g, ' ')
  const detail = clean(value?.detail, 1800)
  if (!title || !summary || !detail) throw new Error('请填写记忆标题、摘要和详情')
  return { title, summary, detail }
}

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get().user_version
        if (version > 4) throw new Error('记忆库版本高于当前插件支持的版本')
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
        if (version < 2) {
          this.db.exec('ALTER TABLE jobs ADD COLUMN created INTEGER NOT NULL DEFAULT 0; ' +
            'ALTER TABLE jobs ADD COLUMN lease TEXT; UPDATE jobs SET created = available;')
        }
        if (version < 3) this.db.exec(`
          ALTER TABLE personas ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE bindings ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
          ALTER TABLE bindings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
          UPDATE bindings SET instructions = (SELECT instructions FROM personas WHERE id = bindings.persona);
          ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
          PRAGMA user_version = 3;
        `)
        if (version < 4) this.db.exec(`
          ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'turn';
          ALTER TABLE jobs ADD COLUMN chunk_hash TEXT;
          ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'turn';
          CREATE TABLE imported_chunks (
            persona TEXT NOT NULL REFERENCES personas(id), session TEXT NOT NULL, hash TEXT NOT NULL,
            created INTEGER NOT NULL, PRIMARY KEY(persona, session, hash)
          );
          DROP TABLE IF EXISTS candidates;
          PRAGMA user_version = 4;
        `)
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
    if (!name) throw new Error('请填写人格名称')
    if (id && instructions === undefined) {
      const result = this.db.prepare('UPDATE personas SET name = ? WHERE id = ?').run(name, id)
      if (!result.changes) throw new Error('人格不存在')
      return id
    }
    instructions = clean(instructions, 3500)
    if (id) {
      const result = this.db.prepare('UPDATE personas SET name = ?, instructions = ?, ' +
        'revision = revision + (instructions <> ?) WHERE id = ?').run(name, instructions, instructions, id)
      if (!result.changes) throw new Error('人格不存在')
      return id
    }
    id = randomUUID()
    this.db.prepare('INSERT INTO personas (id, name, instructions) VALUES (?, ?, ?)').run(id, name, instructions)
    return id
  }

  personaFor(session) {
    return this.db.prepare('SELECT p.id, p.name, b.instructions, b.revision FROM bindings b ' +
      'JOIN personas p ON p.id = b.persona WHERE b.session = ?').get(session)
  }

  boundSessions(persona) {
    return new Set(this.db.prepare('SELECT session FROM bindings WHERE persona = ?').all(persona).map(row => row.session))
  }

  bindingsMap() {
    const rows = this.db.prepare(
      'SELECT b.session, b.persona, p.name FROM bindings b JOIN personas p ON p.id = b.persona',
    ).all()
    return new Map(rows.map(row => [row.session, { persona: row.persona, name: row.name }]))
  }

  bind(session, persona) {
    if (persona === '') {
      this.db.prepare('DELETE FROM bindings WHERE session = ?').run(session)
      return
    }
    const result = this.db.prepare('INSERT INTO bindings (session, persona, instructions, revision) ' +
      'SELECT ?, id, instructions, revision FROM personas WHERE id = ? ON CONFLICT(session) DO UPDATE SET ' +
      'persona = excluded.persona, instructions = excluded.instructions, revision = excluded.revision').run(session, persona)
    if (!result.changes) throw new Error('人格不存在')
  }

  refreshBinding(session) {
    this.db.prepare('UPDATE bindings SET instructions = p.instructions, revision = p.revision ' +
      'FROM personas p WHERE bindings.session = ? AND p.id = bindings.persona AND bindings.revision <> p.revision')
      .run(session)
  }

  enqueue(job) {
    const now = Date.now()
    return this.db.prepare(
      'INSERT OR IGNORE INTO jobs (session, turn, persona, workspace, provider, model, input, available, created, source, chunk_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(job.session, job.turn, job.persona, job.workspace,
      job.provider, job.model, job.input, now, now, job.source ?? 'turn', job.chunk_hash ?? null).changes > 0
  }

  isImported(persona, session, hash) {
    return Boolean(
      this.db.prepare(
        'SELECT 1 FROM imported_chunks WHERE persona = ? AND session = ? AND hash = ?',
      ).get(persona, session, hash) ||
      this.db.prepare(
        'SELECT 1 FROM jobs WHERE persona = ? AND session = ? AND chunk_hash = ?',
      ).get(persona, session, hash),
    )
  }

  nextImportTurn(session) {
    const row = this.db.prepare(
      'SELECT COALESCE(MIN(turn), 0) - 1 AS turn FROM jobs WHERE session = ? AND turn < 0',
    ).get(session)
    return row?.turn ?? -1
  }

  markImported(persona, session, hash) {
    this.db.prepare(
      'INSERT OR IGNORE INTO imported_chunks (persona, session, hash, created) VALUES (?, ?, ?, ?)',
    ).run(persona, session, hash, Date.now())
  }

  importProgress(persona) {
    const pendingRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE source = 'import' AND persona = ? AND attempt < 3",
    ).get(persona)
    const failedRow = this.db.prepare(
      'SELECT COUNT(*) AS count FROM jobs WHERE persona = ? AND attempt >= 3',
    ).get(persona)
    return { pending: pendingRow?.count ?? 0, failed: failedRow?.count ?? 0 }
  }

  retryFailed(persona = '') {
    const now = Date.now()
    if (persona) {
      return this.db.prepare(
        'UPDATE jobs SET attempt = 0, lease = NULL, available = ? WHERE persona = ? AND attempt >= 3',
      ).run(now, persona).changes
    }
    return this.db.prepare(
      'UPDATE jobs SET attempt = 0, lease = NULL, available = ? WHERE attempt >= 3',
    ).run(now).changes
  }

  nextJob() {
    return this.transaction(() => {
      const now = Date.now()
      const job = this.db.prepare(
        "SELECT * FROM jobs WHERE attempt < 3 AND available <= ? ORDER BY (source = 'turn') DESC, available, session, turn LIMIT 1",
      ).get(now)
      if (!job) return undefined
      const lease = randomUUID()
      this.db.prepare('UPDATE jobs SET lease = ?, available = ? WHERE session = ? AND turn = ?')
        .run(lease, now + 60000, job.session, job.turn)
      return { ...job, lease }
    })
  }

  fail(job) {
    if (job.attempt >= 2) {
      this.db.prepare('UPDATE jobs SET attempt = 3, lease = NULL, available = 0 WHERE session = ? AND turn = ? AND lease = ?')
        .run(job.session, job.turn, job.lease)
      return
    }
    this.db.prepare('UPDATE jobs SET attempt = attempt + 1, lease = NULL, available = ? WHERE session = ? AND turn = ? AND lease = ?')
      .run(Date.now() + (job.attempt + 1) * 15000, job.session, job.turn, job.lease)
  }

  saveExtractedMemories({ persona, session, turn, workspace, created, items, source = 'turn' }) {
    const save = this.db.prepare(
      'INSERT INTO memories (id, persona, topic, kind, title, summary, detail, session, turn, workspace, updated, source) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(persona, kind, topic, workspace) DO UPDATE SET ' +
      'title = excluded.title, summary = excluded.summary, detail = excluded.detail, session = excluded.session, ' +
      'turn = excluded.turn, updated = excluded.updated, source = excluded.source, revision = memories.revision + 1 ' +
      'WHERE memories.updated <= excluded.updated AND (memories.title <> excluded.title ' +
      'OR memories.summary <> excluded.summary OR memories.detail <> excluded.detail)',
    )
    let saved = 0
    for (const item of items.slice(0, 4)) {
      if (!item || typeof item !== 'object' || !kinds.has(item.kind)) continue
      const topic = clean(item.topic, 100).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
      if (!topic) continue
      let text
      try { text = memoryText(item) } catch { continue }
      const scope = item.kind === 'preference' ? '' : workspace
      const result = save.run(randomUUID(), persona, topic, item.kind, text.title, text.summary, text.detail,
        session, turn, scope, created, source)
      if (result.changes) saved++
    }
    return saved
  }

  finish(job, items) {
    this.transaction(() => {
      const accepted = this.db.prepare('DELETE FROM jobs WHERE session = ? AND turn = ? AND lease = ?')
        .run(job.session, job.turn, job.lease)
      if (!accepted.changes) return
      if (this.personaFor(job.session)?.id !== job.persona) return
      const source = job.source ?? 'turn'
      this.saveExtractedMemories({
        persona: job.persona, session: job.session, turn: job.turn,
        workspace: job.workspace, created: job.created, items, source,
      })
      if (source === 'import' && job.chunk_hash) {
        this.markImported(job.persona, job.session, job.chunk_hash)
      }
    })
  }

  edit(persona, id, value) {
    const { title, summary, detail } = memoryText(value)
    const result = this.db.prepare('UPDATE memories SET title = ?, summary = ?, detail = ?, updated = ?, revision = revision + 1 ' +
      'WHERE persona = ? AND id = ?').run(title, summary, detail, Date.now(), persona, id)
    if (!result.changes) throw new Error('长期记忆不存在')
  }

  topics(persona, workspace) {
    return this.db.prepare('SELECT kind, topic, title, summary FROM memories WHERE persona = ? ' +
      "AND (workspace = ? OR workspace = '') ORDER BY updated DESC LIMIT 12").all(persona, workspace)
  }

  recall(persona, workspace, query, session) {
    const text = clean(query, 300)
    if (!text) return []
    const previous = /(?:继续|接着|接续)(?:聊|做)?(?:上次|上一轮|之前)|上(?:一|个|一个)\s*(?:会话|对话|session)|最近(?:一次|的)?\s*(?:会话|对话|session)|\b(?:previous|last) (?:session|chat|conversation)\b/iu
    if (!previous.test(text)) return this.search(persona, workspace, text, { scoped: true }).slice(0, 4)
    return this.db.prepare(`
      SELECT kind, title, summary, detail, session, turn, workspace FROM memories
      WHERE persona = ? AND (workspace = ? OR workspace = '') AND session = (
        SELECT session FROM memories WHERE persona = ? AND (workspace = ? OR workspace = '') AND session <> ?
        GROUP BY session ORDER BY MAX(updated) DESC, session LIMIT 1
      )
      ORDER BY (kind = 'progress') DESC, updated DESC, id LIMIT 4
    `).all(persona, workspace, persona, workspace, session)
  }

  search(persona, workspace, query = '', { scoped = false } = {}) {
    const needle = clean(query, 300).normalize('NFKC').toLowerCase()
    const terms = tokens(needle)
    const references = needle.match(/[\p{L}\p{N}_]+(?:[-./:#][\p{L}\p{N}_]+)+/gu) ?? []
    const numbers = needle.match(/\d+/g) ?? []
    const rows = scoped
      ? this.db.prepare(
        'SELECT id, kind, topic, title, summary, detail, session, turn, workspace, updated, source FROM memories ' +
        "WHERE persona = ? AND (workspace = ? OR workspace = '') ORDER BY updated DESC, id LIMIT ?",
      ).all(persona, workspace, LIMIT)
      : this.db.prepare(
        'SELECT id, kind, topic, title, summary, detail, session, turn, workspace, updated, source FROM memories ' +
        'WHERE persona = ? ORDER BY updated DESC, id LIMIT ?',
      ).all(persona, LIMIT)
    if (!needle) return rows.sort((a, b) => Number(b.workspace === workspace) - Number(a.workspace === workspace)).slice(0, 8)
    return rows.map(row => {
      const value = [row.topic, row.title, row.summary, row.detail].join(' ').normalize('NFKC').toLowerCase()
      const valueNumbers = new Set(value.match(/\d+/g) ?? [])
      const indexed = tokens(value)
      let overlap = 0
      for (const term of terms) if (indexed.has(term)) overlap++
      const indexedReferences = value.match(/[\p{L}\p{N}_]+(?:[-./:#][\p{L}\p{N}_]+)+/gu) ?? []
      let score = value.includes(needle) ? 4 :
        references.some(reference => indexedReferences.includes(reference)) ? 2 : overlap / Math.max(1, terms.size)
      if (numbers.length > 0) {
        const matched = numbers.filter(number => valueNumbers.has(number)).length
        if (matched === 0) score *= 0.5
        else if (matched === numbers.length) score += 0.2
      }
      return { row, score }
    }).filter(result => result.score >= 0.34)
      .sort((a, b) => b.score - a.score || Number(b.row.workspace === workspace) - Number(a.row.workspace === workspace))
      .slice(0, 8).map(result => result.row)
  }

  forget(persona, id) {
    return this.db.prepare('DELETE FROM memories WHERE persona = ? AND id = ?').run(persona, id).changes > 0
  }
}
