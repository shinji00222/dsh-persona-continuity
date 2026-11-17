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
        if (version > 3) throw new Error('记忆库版本高于当前插件支持的版本')
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
          CREATE TABLE candidates (
            id TEXT PRIMARY KEY, persona TEXT NOT NULL REFERENCES personas(id),
            topic TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL,
            session TEXT NOT NULL, turn INTEGER NOT NULL, workspace TEXT NOT NULL, created INTEGER NOT NULL,
            base_id TEXT, base_revision INTEGER, state TEXT NOT NULL DEFAULT 'pending'
              CHECK(state IN ('pending', 'approved', 'rejected')),
            UNIQUE(persona, session, turn, kind, topic, workspace)
          );
          CREATE INDEX candidates_pending ON candidates(persona, state, created DESC);
          INSERT INTO candidates (id, persona, topic, kind, title, summary, detail, session, turn, workspace, created)
            SELECT id, persona, topic, kind, title, summary, detail, session, turn, workspace, updated FROM memories;
          DELETE FROM memories;
          PRAGMA user_version = 3;
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
    instructions = clean(instructions, 3500)
    if (!name) throw new Error('请填写人格名称')
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
      if (this.personaFor(job.session)?.id !== job.persona) return
      const propose = this.db.prepare(
        'INSERT INTO candidates (id, persona, topic, kind, title, summary, detail, session, turn, workspace, created, base_id, base_revision) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(persona, session, turn, kind, topic, workspace) DO NOTHING',
      )
      for (const item of items.slice(0, 4)) {
        if (!item || typeof item !== 'object' || !kinds.has(item.kind)) continue
        const topic = clean(item.topic, 100).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
        if (!topic) continue
        let text
        try { text = memoryText(item) } catch { continue }
        const workspace = item.kind === 'preference' ? '' : job.workspace
        const current = this.memoryForTopic(job.persona, item.kind, topic, workspace)
        if (current && text.title === current.title && text.summary === current.summary && text.detail === current.detail) continue
        propose.run(randomUUID(), job.persona, topic, item.kind, text.title, text.summary, text.detail,
          job.session, job.turn, workspace, job.created, current?.id ?? null, current?.revision ?? null)
      }
    })
  }

  memoryForTopic(persona, kind, topic, workspace) {
    return this.db.prepare('SELECT id, revision, title, summary, detail FROM memories ' +
      'WHERE persona = ? AND kind = ? AND topic = ? AND workspace = ?').get(persona, kind, topic, workspace)
  }

  pending(persona) {
    return this.db.prepare("SELECT id, kind, title, summary, detail, session, turn, base_id FROM candidates " +
      "WHERE persona = ? AND state = 'pending' ORDER BY created DESC, id LIMIT 50").all(persona)
  }

  review(persona, id, action, edits) {
    return this.transaction(() => {
      if (action !== 'approve' && action !== 'reject') throw new Error('审核操作无效')
      const candidate = this.db.prepare('SELECT * FROM candidates WHERE persona = ? AND id = ?').get(persona, id)
      if (!candidate) throw new Error('待确认记忆不存在')
      if (candidate.state !== 'pending') return candidate.state
      if (action === 'approve') {
        const current = this.memoryForTopic(persona, candidate.kind, candidate.topic, candidate.workspace)
        if ((current?.id ?? null) !== candidate.base_id || (current?.revision ?? null) !== candidate.base_revision) {
          throw new Error('对应记忆已修改或删除，请拒绝这条旧候选')
        }
        const { title, summary, detail } = memoryText(edits ?? candidate)
        this.db.prepare(
          'INSERT INTO memories (id, persona, topic, kind, title, summary, detail, session, turn, workspace, updated) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(persona, kind, topic, workspace) DO UPDATE SET ' +
          'title = excluded.title, summary = excluded.summary, detail = excluded.detail, session = excluded.session, ' +
          'turn = excluded.turn, updated = excluded.updated, revision = memories.revision + 1',
        ).run(candidate.id, persona, candidate.topic, candidate.kind, title, summary, detail,
          candidate.session, candidate.turn, candidate.workspace, Date.now())
      }
      const state = action === 'approve' ? 'approved' : 'rejected'
      this.db.prepare("UPDATE candidates SET state = ?, title = '', summary = '', detail = '' WHERE id = ?").run(state, id)
      return state
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

  summary(persona, workspace, query) {
    const text = clean(query, 300)
    if (!text) return []
    const continueLast = /^(?:请)?(?:继续上次(?:的(?:进度|工作|任务))?|接着上次(?:聊|做)?)[。！!？?\s]*$/u.test(text)
    return this.search(persona, workspace, continueLast ? '' : text).slice(0, 6)
      .map(({ id, kind, title, summary, session, turn }) => ({ id, kind, title, summary, session, turn }))
  }

  search(persona, workspace, query = '') {
    const needle = clean(query, 300).normalize('NFKC').toLowerCase()
    const terms = tokens(needle)
    const references = needle.match(/[\p{L}\p{N}_]+(?:[-./:#][\p{L}\p{N}_]+)+/gu) ?? []
    const numbers = needle.match(/\d+/g) ?? []
    const rows = this.db.prepare(
      'SELECT id, kind, topic, title, summary, detail, session, turn, workspace, updated FROM memories WHERE persona = ? ' +
      'ORDER BY updated DESC, id LIMIT ?',
    ).all(persona, LIMIT)
    if (!needle) return rows.sort((a, b) => Number(b.workspace === workspace) - Number(a.workspace === workspace)).slice(0, 8)
    return rows.map(row => {
      const value = [row.topic, row.title, row.summary, row.detail].join(' ').normalize('NFKC').toLowerCase()
      const valueNumbers = new Set(value.match(/\d+/g) ?? [])
      if (numbers.some(number => !valueNumbers.has(number))) return { row, score: 0 }
      const indexed = tokens(value)
      let overlap = 0
      for (const term of terms) if (indexed.has(term)) overlap++
      const indexedReferences = value.match(/[\p{L}\p{N}_]+(?:[-./:#][\p{L}\p{N}_]+)+/gu) ?? []
      const score = value.includes(needle) ? 4 :
        references.some(reference => indexedReferences.includes(reference)) ? 2 : overlap / Math.max(1, terms.size)
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
