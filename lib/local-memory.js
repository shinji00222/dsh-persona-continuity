import { createHash, randomUUID } from 'node:crypto'
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const safeId = /^[a-z0-9][a-z0-9_-]{0,127}$/
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const header = /^\uFEFF?<!-- persona-memory (.*) -->\r?\n/

export function isMemoryId(id) {
  return typeof id === 'string' && safeId.test(id) && !windowsDevice.test(id)
}

function checkedId(id) {
  if (!isMemoryId(id)) {
    throw new Error('无效的人格或记忆 ID')
  }
  return id
}

function stat(path) {
  try { return lstatSync(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function directory(path, create = false) {
  if (create) mkdirSync(path, { recursive: true })
  const info = stat(path)
  if (!info) return false
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('记忆目录不可用')
  return true
}

function textFile(path) {
  const info = stat(path)
  if (!info) return undefined
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32000) {
    throw new Error('记忆文件不可用')
  }
  return readFileSync(path, 'utf8')
}

function replace(path, text) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    if (stat(temporary)) unlinkSync(temporary)
  }
}

function serialize({ id, kind, topic, workspace, updated, operationId, deleted, source, session, turn, manual, title, summary, detail, evidence }) {
  const meta = deleted
    ? { id, kind, topic, workspace, updated, deleted: true }
    : { id, kind, topic, workspace, updated, operationId, source, session, turn, manual, evidence }
  const encoded = JSON.stringify(meta).replaceAll('--', '\\u002d\\u002d')
  return '<!-- persona-memory ' + encoded + ' -->\n' +
    (deleted ? '' : '# ' + title + '\n\n' + summary + '\n\n---\n\n' + detail + '\n')
}

function parse(raw, id) {
  const marker = header.exec(raw)
  if (!marker) return undefined
  const meta = JSON.parse(marker[1])
  if (meta.id !== id || typeof meta.topic !== 'string' || typeof meta.workspace !== 'string' ||
      !Number.isFinite(meta.updated)) return undefined
  const revision = createHash('sha256').update(raw).digest('hex')
  if (meta.deleted === true) return { ...meta, revision }
  const body = /^# ([^\n]+)\n\n([\s\S]+?)\n\n---\n\n([\s\S]+)$/.exec(raw.slice(marker[0].length).replaceAll('\r\n', '\n'))
  if (!body || typeof meta.session !== 'string' || !Number.isInteger(meta.turn)) return undefined
  const [, title, summary, detail] = body
  if (!title.trim() || !summary.trim() || !detail.trim()) return undefined
  return { ...meta, title: title.trim().slice(0, 90), summary: summary.trim().slice(0, 160),
    detail: detail.trim().slice(0, 1800), revision }
}

export class LocalMemory {
  constructor(root, clean) {
    this.root = root && resolve(root)
    this.clean = clean
    this.temporary = root ? undefined : new Map()
  }

  paths(persona, create = false) {
    const id = checkedId(persona)
    if (!directory(dirname(this.root), create)) return undefined
    if (!directory(this.root, create)) return undefined
    const folder = join(this.root, id)
    if (!directory(folder, create)) return undefined
    const notes = join(folder, 'notes')
    if (!directory(notes, create)) return undefined
    return { notes, index: join(folder, 'MEMORY.md') }
  }

  read(persona, id) {
    checkedId(persona)
    checkedId(id)
    const paths = this.temporary ? undefined : this.paths(persona)
    const raw = this.temporary
      ? this.temporary.get(persona)?.get(id)
      : paths && textFile(join(paths.notes, id + '.md'))
    if (!raw) return undefined
    let note
    try { note = parse(raw, id) } catch { return undefined }
    if (!note || note.deleted) return note
    return { ...note, title: this.clean(note.title, 90), summary: this.clean(note.summary, 160),
      detail: this.clean(note.detail, 1800), evidence: this.clean(note.evidence, 300) }
  }

  list(persona) {
    if (!persona) return []
    const paths = this.temporary ? undefined : this.paths(persona)
    const ids = this.temporary
      ? [...(this.temporary.get(persona)?.keys() ?? [])]
      : paths ? readdirSync(paths.notes, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name.slice(0, -3)).filter(isMemoryId) : []
    return ids.map(id => this.read(persona, id)).filter(Boolean)
      .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
  }

  write(persona, note) {
    checkedId(persona)
    const id = checkedId(note.id)
    const content = serialize(note)
    if (this.temporary) {
      if (!this.temporary.has(persona)) this.temporary.set(persona, new Map())
      this.temporary.get(persona).set(id, content)
      return
    }
    const { notes } = this.paths(persona, true)
    const path = join(notes, id + '.md')
    textFile(path)
    replace(path, content)
  }

  exists(persona, id) {
    checkedId(id)
    if (this.temporary) return this.temporary.get(persona)?.has(id) ?? false
    const paths = this.paths(persona)
    return Boolean(paths && stat(join(paths.notes, id + '.md')))
  }

  rebuild(persona, coreIds = []) {
    if (this.temporary) return
    const paths = this.paths(persona)
    if (!paths) return
    const notes = this.list(persona).filter(note => !note.deleted)
    const core = notes.filter(note => coreIds.includes(note.id)).slice(0, 6)
    const links = notes.filter(note => !coreIds.includes(note.id)).slice(0, 16)
    const label = ({ id, title }) => '- ' + title.replace(/[[\]<>\r\n]/g, ' ') + ' (notes/' + id + '.md)'
    const lines = core.length ? ['## 核心记忆', ...core.map(note => label(note) + ' — ' + note.summary), ''] : []
    const content = ['# MEMORY', '', ...lines, '## 笔记索引', ...links.map(label), ''].join('\n')
    if (textFile(paths.index) !== content) replace(paths.index, content)
  }
}
