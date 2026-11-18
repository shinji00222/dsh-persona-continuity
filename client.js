window.__ModuleLoader__.load({
  id: 'dsh-persona-continuity',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useId, useState } = React
    const { Button, Menu, Modal, Input, IconChevronDownOutlineRegular, IconPlusOutlineRegular, IconListPenOutlineRegular } =
      require('@deepseek-ai/dsh-client-ui-primitives')
    const base = '/api/persona-continuity'
    const changedEvent = 'persona-continuity:changed'
    const normalOption = '__normal__'
    const createOption = '__create__'
    const simulationPanel = 'persona-continuity-simulation'

    async function call(path, data) {
      const headers = {}
      const options = { headers }
      if (data !== undefined) {
        options.method = 'POST'
        options.body = JSON.stringify(data)
        headers['content-type'] = 'application/json'
      }
      const response = await fetch(base + path, options)
      const result = await response.json().catch(() => null)
      if (!response.ok || result === null) throw new Error(result?.error || '无法读取人格记忆')
      return result
    }

    const dictionaries = {
      zh: {
        title: '人格续忆', normal: '普通会话', persona: '人格', new: '新建人格', name: '名称', instructions: '人格设定',
        close: '关闭', cancel: '取消', createAndUse: '创建并使用', namePlaceholder: '输入人格名称',
        rename: '重命名', renamePersona: '重命名人格',
        save: '保存人格', index: '记忆索引', search: '查找记忆', forget: '删除记忆', confirm: '删除这条长期记忆？',
        empty: '暂无匹配记忆', source: '来源会话', turn: '轮次', locked: '已开始的会话沿用原人格',
        edit: '编辑', saveMemory: '保存记忆',
        memoryTitle: '标题', summary: '摘要', detail: '详情', loading: '加载中…',
      },
      en: {
        title: 'Persona Continuity', normal: 'Standard chat', persona: 'Persona', new: 'New persona', name: 'Name',
        close: 'Close', cancel: 'Cancel', createAndUse: 'Create and use', namePlaceholder: 'Enter a persona name',
        rename: 'Rename', renamePersona: 'Rename persona',
        instructions: 'Persona instructions', save: 'Save persona', index: 'Memory index', search: 'Search memories',
        forget: 'Forget', confirm: 'Delete this long-term memory?', empty: 'No matching memories', source: 'Source chat',
        turn: 'Turn', locked: 'The persona is fixed after the chat starts',
        edit: 'Edit', saveMemory: 'Save memory',
        memoryTitle: 'Title', summary: 'Summary', detail: 'Details', loading: 'Loading…',
      },
    }

    const selectStyle = {
      maxWidth: '12em', color: 'inherit', background: 'var(--dsw-alias-background-primary, Canvas)',
      border: '1px solid var(--dsw-alias-border-secondary, GrayText)', borderRadius: 6, padding: '3px 6px',
    }
    const pickerStyle = { display: 'inline-flex', alignItems: 'center', minWidth: 0 }
    const choiceStyle = { maxWidth: 'clamp(74px, 13vw, 155px)', padding: '0 6px' }
    const labelStyle = { overflow: 'hidden', minWidth: 0, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    const panelStyle = { display: 'grid', gap: 12, maxWidth: 720 }
    const errorMessage = error => error ? h('span', { role: 'alert' }, error) : null
    const statePath = id => '/state?session=' + encodeURIComponent(id ?? '')

    function Picker({ sessionId, t }) {
      const [state, setState] = useState(null)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState('')
      const [mode, setMode] = useState(null)
      const [name, setName] = useState('')
      const [renameId, setRenameId] = useState('')
      const [renamePoint, setRenamePoint] = useState(null)
      const formId = useId()

      useEffect(() => {
        if (!sessionId) return
        let live = true
        const refresh = () => call(statePath(sessionId)).then(
          value => { if (live) setState(value) },
          failure => { if (live) setError(failure.message) },
        )
        void refresh()
        window.addEventListener('focus', refresh)
        window.addEventListener(changedEvent, refresh)
        return () => {
          live = false
          window.removeEventListener('focus', refresh)
          window.removeEventListener(changedEvent, refresh)
        }
      }, [sessionId])

      if (!sessionId || !state) return errorMessage(error)

      async function select(id) {
        setMode(null)
        if (id === state.selected) return
        setPending(true)
        setError('')
        try {
          setState(await call('/bind', { session: sessionId, persona: id }))
        } catch (failure) {
          setError(failure.message)
        } finally {
          setPending(false)
        }
      }

      async function saveName(event) {
        event.preventDefault()
        const title = name.trim()
        if (pending || !title) return
        setPending(true)
        setError('')
        try {
          if (mode === 'rename') {
            await call('/persona', { id: renameId, name: title })
            setState(current => ({
              ...current,
              personas: current.personas.map(persona => persona.id === renameId ? { ...persona, name: title } : persona),
            }))
          } else {
            setState(await call('/create', { session: sessionId, name: title }))
          }
          setMode(null)
          window.dispatchEvent(new Event(changedEvent))
        } catch (failure) {
          setError(failure.message)
        } finally {
          setPending(false)
        }
      }

      function closeName() {
        if (pending) return
        setMode(null)
        setError('')
      }

      const selected = state.personas.find(persona => persona.id === state.selected)
      const label = selected?.name ?? t('normal')
      const renaming = mode === 'rename'
      function openRenameMenu(event) {
        if (pending || !(event.target instanceof Element)) return
        const row = event.target.closest('[role="menuitem"], [data-persona-picker]')
        const target = row?.querySelector('[data-persona-id]')?.dataset.personaId
        const persona = state.personas.find(item => item.id === target)
        if (!persona) return
        event.preventDefault()
        event.stopPropagation()
        const rect = row.getBoundingClientRect()
        setRenamePoint(event.clientX || event.clientY
          ? { x: event.clientX, y: event.clientY }
          : { x: rect.left, y: rect.bottom })
        setRenameId(persona.id)
        setName(persona.name)
        setError('')
        setMode('context')
      }

      return h('div', {
        style: pickerStyle,
        onContextMenu: openRenameMenu,
        onKeyDownCapture: event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openRenameMenu(event)
        },
      },
        h(Menu, {
          open: mode === 'menu',
          onClose: () => setMode(current => current === 'menu' ? null : current),
          items: [
            { id: normalOption, label: t('normal') },
            { id: createOption, label: t('new'), icon: h(IconPlusOutlineRegular, { size: 16, 'aria-hidden': true }) },
            ...state.personas.map(persona => ({
              id: persona.id, label: h('span', { 'data-persona-id': persona.id }, persona.name),
            })),
          ],
          selectedId: state.selected || normalOption,
          onSelect: id => {
            if (id !== createOption) {
              void select(id === normalOption ? '' : id)
              return
            }
            setName('')
            setError('')
            setMode('create')
          },
          align: 'start', portal: true,
          anchor: h(Button, {
            size: 'sm', type: 'button', style: choiceStyle,
            'aria-label': t('persona') + '：' + label, 'aria-haspopup': 'menu', 'aria-expanded': mode === 'menu',
            title: state.editable ? label : t('locked'),
            disabled: pending,
            'aria-disabled': !state.editable,
            'data-persona-picker': '',
            onClick: () => {
              if (!state.editable) return
              setError('')
              setMode(mode === 'menu' ? null : 'menu')
            },
          },
          h('span', { style: labelStyle, 'data-persona-id': selected?.id }, label),
          h(IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true })),
        }),
        h(Menu, {
          anchor: null, anchorPoint: renamePoint, contextual: true, portal: true, autoFocus: true,
          open: mode === 'context', items: [{ id: 'rename', label: t('rename') }],
          onClose: () => setMode(current => current === 'context' ? null : current),
          onSelect: () => setMode('rename'),
        }),
        mode !== 'create' && !renaming && errorMessage(error),
        h(Modal, {
          title: t(renaming ? 'renamePersona' : 'new'), closeLabel: t('close'),
          open: mode === 'create' || renaming, onClose: closeName,
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', disabled: pending, onClick: closeName }, t('cancel')),
            h(Button, { variant: 'primary', type: 'submit', form: formId, disabled: pending || !name.trim() },
              t(renaming ? 'rename' : 'createAndUse'))),
        },
        h('form', { id: formId, onSubmit: saveName, style: { display: 'grid', gap: 8 } },
          h(Input, {
            'aria-label': t('name'), 'data-modal-autofocus': '', placeholder: t('namePlaceholder'),
            value: name, required: true, maxLength: 48, onChange: event => setName(event.target.value),
          }),
          errorMessage(error),
        )),
      )
    }

    const textareaStyle = { display: 'block', width: '100%' }
    const actionsStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' }

    function MemoryCard({ row, t, mutate }) {
      const [edits, setEdits] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      function edit() {
        setEdits({ title: row.title, summary: row.summary, detail: row.detail })
        setError('')
      }

      async function submit(path, value) {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await mutate(path, { id: row.id, edits: value })
          setEdits(null)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const field = (key, label, maxLength, control, props = {}) => h('label', null, t(label),
        h(control, {
          ...props, value: edits[key], required: true, maxLength, disabled: busy,
          onChange: event => setEdits({ ...edits, [key]: event.target.value }),
        }))
      const button = (label, onClick) => h(Button, {
        size: 'sm', variant: 'outline', type: 'button', disabled: busy, onClick,
      }, t(label))

      return h('details', null,
        h('summary', null, row.title, ' · ', row.summary),
        h('p', { style: { overflowWrap: 'anywhere' } }, t('source'), ' ', row.session, ' · ', t('turn'), ' ', row.turn),
        edits ? h('form', {
          style: panelStyle, onSubmit: event => {
            event.preventDefault()
            void submit('/edit', edits)
          },
        },
        field('title', 'memoryTitle', 90, Input),
        field('summary', 'summary', 160, Input),
        field('detail', 'detail', 1800, 'textarea', { rows: 5, style: textareaStyle }),
        h('div', { style: actionsStyle },
          h(Button, { size: 'sm', variant: 'primary', type: 'submit', disabled: busy }, t('saveMemory')),
          button('cancel', () => { setEdits(null); setError('') })),
        ) : h(React.Fragment, null,
          h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, row.detail),
          h('div', { style: actionsStyle },
            button('edit', edit),
            button('forget', () => { if (window.confirm(t('confirm'))) void submit('/forget') }),
          )),
        errorMessage(error),
      )
    }

    function MemoryPanel({ id, t }) {
      const [query, setQuery] = useState('')
      const [rows, setRows] = useState(null)
      const [revision, setRevision] = useState(0)
      const [error, setError] = useState('')
      const persona = '?persona=' + encodeURIComponent(id)

      useEffect(() => {
        let live = true
        const timer = setTimeout(() => {
          call('/index' + persona + '&q=' + encodeURIComponent(query))
            .then(value => { if (live) setRows(value) }, failure => { if (live) setError(failure.message) })
        }, 180)
        return () => { live = false; clearTimeout(timer) }
      }, [persona, query, revision])

      async function mutate(path, { id: entry, ...data }) {
        await call(path, { ...data, persona: id, id: entry })
        setError('')
        setRevision(current => current + 1)
      }

      return h('div', { style: panelStyle },
        h('h3', null, t('index')),
        h(Input, {
          type: 'search', 'aria-label': t('search'), placeholder: t('search'), value: query, maxLength: 300,
          onChange: event => { setRows(null); setQuery(event.target.value) },
        }),
        rows === null ? h('p', null, t('loading')) : rows.length
          ? rows.map(row => h(MemoryCard, { key: row.id, row, t, mutate }))
          : h('p', null, t('empty')),
        errorMessage(error),
      )
    }

    function Settings({ t }) {
      const [personas, setPersonas] = useState([])
      const [id, setId] = useState('')
      const [name, setName] = useState('')
      const [instructions, setInstructions] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let live = true
        call('/state').then(value => { if (live) setPersonas(value.personas) },
          failure => { if (live) setError(failure.message) })
        return () => { live = false }
      }, [])

      function choose(next) {
        const persona = personas.find(item => item.id === next)
        setId(next)
        setName(persona?.name ?? '')
        setInstructions(persona?.instructions ?? '')
        setError('')
      }

      async function save(event) {
        event.preventDefault()
        setBusy(true)
        try {
          const saved = await call('/persona', { id, name, instructions })
          setPersonas((await call('/state')).personas)
          setId(saved.id)
          setError('')
          window.dispatchEvent(new Event(changedEvent))
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      return h('section', { style: panelStyle },
        h('label', null, t('persona'), ' ', h('select', { style: selectStyle, value: id, disabled: busy, onChange: e => choose(e.target.value) },
          h('option', { value: '' }, t('new')),
          personas.map(persona => h('option', { key: persona.id, value: persona.id }, persona.name)))),
        h('form', { onSubmit: save, style: panelStyle },
          h('label', null, t('name'), ' ', h(Input, { value: name, required: true, maxLength: 48, onChange: e => setName(e.target.value) })),
          h('label', null, t('instructions'), h('textarea', {
            value: instructions, rows: 4, maxLength: 3500,
            style: textareaStyle, onChange: e => setInstructions(e.target.value),
          })),
          h(Button, { variant: 'primary', type: 'submit', disabled: busy, style: { justifySelf: 'start' } }, t('save'))),
        errorMessage(error),
        id && h(MemoryPanel, { key: id, id, t }),
      )
    }

    const sampleRoles = [
      { id: 'patient-1', name: '初诊患者', group: '患者', background: '第一次就诊，听到专业术语容易紧张，倾向于回家再看说明。' },
      { id: 'patient-2', name: '复诊患者', group: '患者', background: '需要在工作日安排复诊，希望记住这次沟通中提到的事项。' },
      { id: 'doctor-1', name: '门诊医生', group: '医生', background: '门诊时间紧，希望用简洁的表达，并确认患者理解了关键事项。' },
    ]
    const sampleQuestions = [
      { id: 'clarity', text: '从你的角色看，本次用药沟通中关键信息讲清楚了吗？', options: ['清楚', '部分清楚', '不清楚'] },
      { id: 'confirmation', text: '本次沟通中，患者有没有用自己的话确认理解？', options: ['有', '没有', '不确定'] },
      { id: 'remaining', text: '还有哪些疑问，或哪一步沟通可以更清楚？' },
    ]
    const sampleMaterial = '这是虚构的门诊沟通场景。就诊结束时，医生介绍了用药安排，并交给患者一份书面说明。双方需要确认患者理解了哪些信息，还有哪些疑问。请评价沟通过程。'
    function readMarkdownQuestionnaire(text, fileName) {
      const questions = []
      const material = []
      let title = ''
      let section = ''
      let current
      for (const [index, raw] of text.split(/\r?\n/u).entries()) {
        const line = raw.trim().replace(/^\*\*(.+)\*\*$/u, '$1')
        if (!line) continue
        const documentTitle = line.match(/^#\s+(.+)$/u)
        if (!title && documentTitle && !current) {
          title = documentTitle[1]
          continue
        }
        const heading = line.match(/^#{2,6}\s+(.+)$/u)?.[1]
        if (heading && /^(公共材料|背景材料|问卷说明|说明)$/u.test(heading)) {
          section = 'material'
          current = undefined
          continue
        }
        if (heading && /^(题目|问卷题目|调查题目)$/u.test(heading)) {
          section = 'questions'
          current = undefined
          continue
        }
        const numbered = line.match(/^(?:第\s*\d+\s*题\s*[：:]?|\d+\s*[.、)）])\s*(.+)$/u)?.[1]
        if (heading || (numbered && section !== 'material')) {
          const prompt = (heading ?? numbered)
            .replace(/^\s*(?:第\s*\d+\s*题\s*[：:]?|\d+\s*[.、)）])\s*/u, '')
            .replace(/^\s*[［\[（(](?:单选题?|开放题)[］\]）)]\s*|\s*[［\[（(](?:单选题?|开放题)[］\]）)]\s*$/gu, '')
            .trim()
          if (!prompt) throw new Error('第 ' + (index + 1) + ' 行缺少题干')
          current = { id: crypto.randomUUID(), text: prompt, options: [] }
          questions.push(current)
          section = 'questions'
          continue
        }
        if (section === 'material' || (!current && !section)) {
          material.push(raw)
          continue
        }
        const option = line.match(/^(?:[-*+]\s+|[A-Z][.、)）]\s*)(.+)$/iu)?.[1]
        if (current && option) {
          current.options.push(option.replace(/^[A-Z][.、)）]\s*/iu, ''))
          continue
        }
        throw new Error('Markdown 第 ' + (index + 1) + ' 行无法识别。请用标题或编号写题目，用列表写选项。')
      }
      return { title: title || fileName.replace(/\.md$/iu, '').slice(0, 100), material: material.join('\n'), questions }
    }

    async function readQuestionnaireFile(file) {
      if (file.size > 180000) throw new Error('问卷文件须小于 180 KB')
      const text = (await file.text()).replace(/^\uFEFF/u, '')
      if (/\.json$/iu.test(file.name)) {
        let imported
        try { imported = JSON.parse(text) }
        catch { throw new Error('JSON 格式有误，请检查文件') }
        if (!imported || !Array.isArray(imported.questions)) throw new Error('JSON 需要包含 questions 题目数组')
        return {
          title: imported.title,
          material: imported.material,
          questions: imported.questions.map(question => ({
            id: question?.id ?? crypto.randomUUID(),
            text: question?.text,
            options: question?.options,
          })),
        }
      }
      if (/\.md$/iu.test(file.name)) return readMarkdownQuestionnaire(text, file.name)
      if (!/\.tsv$/iu.test(file.name)) throw new Error('请选择 Markdown、JSON 或 TSV 文件')
      const lines = text.split(/\r?\n/u).filter(line => line.trim())
      if (lines[0]?.trim() !== '题干\t题型\t选项') throw new Error('TSV 表头须为「题干、题型、选项」三列')
      const questions = lines.slice(1).map((line, index) => {
        const [text, kind, choices = '', ...extra] = line.split('\t').map(cell => cell.trim())
        if (extra.length || !text || !['单选题', '开放题'].includes(kind) ||
          (kind === '开放题' && choices)) {
          throw new Error('第 ' + (index + 2) + ' 行的题干、题型或选项格式有误')
        }
        return {
          id: crypto.randomUUID(), text,
          options: kind === '单选题' ? choices.split('|').map(choice => choice.trim()) : [],
        }
      })
      return { title: file.name.replace(/\.tsv$/iu, '').slice(0, 100), material: '', questions }
    }
    const surveyColumns = {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
      gap: 20, alignItems: 'start',
    }
    const surveyCard = {
      display: 'grid', gap: 14, minWidth: 0, padding: 18, borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-secondary, #72727266)',
      background: 'var(--dsw-alias-background-secondary, transparent)',
    }
    const surveyField = { display: 'grid', gap: 5, minWidth: 0 }
    const surveyTextarea = { ...textareaStyle, boxSizing: 'border-box', resize: 'vertical', padding: 8, borderRadius: 8 }
    const jobStatus = { queued: '排队中', running: '作答中', done: '已完成', failed: '失败' }

    function downloadSurveyResults(result) {
      const rows = [
        ['角色编号', '角色名称', '分组', '状态', '失败原因', ...result.questions.map(question => question.text)],
        ...result.jobs.map(job => {
          const answers = new Map(job.answers.map(answer => [answer.id, answer.answer]))
          return [job.role, job.name, job.group, jobStatus[job.status], job.error,
            ...result.questions.map(question => answers.get(question.id))]
        }),
      ]
      const encodeCell = value => {
        const text = String(value ?? '')
        const escaped = /^\s*[=+@-]/u.test(text) ? "'" + text : text
        return '"' + escaped.replace(/"/g, '""') + '"'
      }
      const body = '\uFEFF' + rows.map(row => row.map(encodeCell).join(',')).join('\r\n') + '\r\n'
      const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = '问卷答卷-' + result.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').slice(0, 80) + '.csv'
      document.body.append(link)
      try { link.click() } finally {
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    }

    const field = (label, control) => h('label', { style: surveyField }, h('span', null, label), control)
    const action = (label, onClick, disabled = false) =>
      h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick, disabled, style: { justifySelf: 'start' } }, label)
    const surveyInput = (value, change, props = {}) =>
      h(Input, { ...props, value, onChange: event => change(event.target.value) })
    const surveyText = (value, change, rows, maxLength) => h('textarea', {
      value, rows, maxLength, style: surveyTextarea, onChange: event => change(event.target.value),
    })
    const updateItem = (setter, index, patch) =>
      setter(items => items.map((item, position) => position === index ? { ...item, ...patch } : item))

    function useSurveyLibrary(kind) {
      const path = '/simulation/' + kind
      const [items, setItems] = useState([])
      const [error, setError] = useState('')
      const refresh = () => call(path).then(setItems)
      useEffect(() => {
        let live = true
        call(path).then(value => { if (live) setItems(value) }, failure => { if (live) setError(failure.message) })
        return () => { live = false }
      }, [path])
      return {
        items, error, refresh,
        read: id => call(path + '/item?id=' + encodeURIComponent(id)),
        save: data => call(path + '/save', data),
        remove: id => call(path + '/remove', { id }),
      }
    }

    const tsvHeader = '编号\t名称\t分组\t背景'
    function readStudentSheet(text) {
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/u).filter(line => line.trim())
      if (lines[0]?.trim() !== tsvHeader) throw new Error('请用「编号、名称、分组、背景」四列表头，并从表格复制或导入 TSV。')
      if (lines.length < 2) throw new Error('请至少录入一名学生')
      return lines.slice(1).map((line, index) => {
        const columns = line.split('\t').map(value => value.trim())
        if (columns.length !== 4 || !columns[0] || !columns[3]) throw new Error('第 ' + (index + 2) + ' 行需要四列，编号和背景必填')
        const [id, name, group, background] = columns
        return { id, name, group, background }
      })
    }

    function StudentBatches({ library, onApply }) {
      const [id, setId] = useState('')
      const [title, setTitle] = useState('')
      const [sheet, setSheet] = useState(tsvHeader + '\n')
      const [preview, setPreview] = useState([])
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')

      async function perform(run) {
        setBusy(true)
        setError('')
        setNotice('')
        try { await run() } catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      function reset() {
        setId('')
        setTitle('')
        setSheet(tsvHeader + '\n')
        setPreview([])
        setNotice('')
        setError('')
      }
      function load(id) {
        if (!id) return reset()
        void perform(async () => {
          const batch = await library.read(id)
          const rows = batch.roles.map(role => [role.id, role.name, role.group, role.background]
            .map(value => value.replace(/[\t\r\n]+/gu, ' ')).join('\t'))
          setId(id)
          setTitle(batch.title)
          setSheet([tsvHeader, ...rows].join('\n'))
          setPreview(batch.roles)
        })
      }
      function changeSheet(value) {
        setSheet(value)
        setPreview([])
        setNotice('')
      }
      return h('div', { style: surveyColumns },
        h('section', { style: surveyCard },
          h('h2', null, '学生批次'),
          field('已保存批次', h('select', {
            value: id, disabled: busy, onChange: event => load(event.target.value), style: { ...selectStyle, maxWidth: '100%' },
          }, h('option', { value: '' }, '新建批次'), library.items.map(batch =>
            h('option', { key: batch.id, value: batch.id }, batch.title + ' · ' + batch.count + ' 人')))),
          field('批次名称', surveyInput(title, setTitle, { maxLength: 100 })),
          field('导入 TSV 文件', h('input', {
            type: 'file', accept: '.tsv,.txt,text/tab-separated-values', disabled: busy,
            onChange: event => {
              const file = event.target.files[0]
              event.target.value = ''
              if (file) void perform(async () => changeSheet(await file.text()))
            },
          })),
          field('粘贴表格', surveyText(sheet, changeSheet, 8)),
          h('p', null, '从表格复制「编号、名称、分组、背景」四列，保留表头。每行一人，编号和背景必填。'),
          h('div', { style: actionsStyle },
            action('预览学生', () => perform(async () => setPreview(readStudentSheet(sheet))), busy),
            action('保存批次', () => perform(async () => {
              const roles = readStudentSheet(sheet)
              const saved = await library.save({ id, title, roles })
              setId(saved.id)
              setPreview(roles)
              await library.refresh()
              setNotice('批次已保存')
            }), busy),
            id && action('删除批次', () => {
              if (window.confirm('删除选中的学生批次？')) void perform(async () => {
                await library.remove(id)
                reset()
                await library.refresh()
              })
            }, busy)),
          errorMessage(error || library.error),
          notice && h('p', { role: 'status' }, notice)),
        h('section', { style: surveyCard },
          h('h2', null, '批次预览'),
          preview.length ? h(React.Fragment, null,
            h('p', null, preview.length + ' 名学生 · 显示前 ' + Math.min(preview.length, 10) + ' 名'),
            h('ul', null, preview.slice(0, 10).map(role => h('li', { key: role.id },
              [role.id, role.name, role.group].filter(Boolean).join(' · ')))),
            action('用于当前问卷', () => onApply(preview), busy))
            : h('p', null, '导入或选择批次后，这里会显示学生名单。')))
    }

    function SurveyEditors({ roles, setRoles, questions, setQuestions, onManageRoles }) {
      const [page, setPage] = useState(0)
      const first = Math.min(page, Math.max(0, Math.ceil(roles.length / 10) - 1)) * 10
      const remove = (setter, index) => setter(items => items.filter((_, position) => position !== index))
      return h('div', { style: surveyColumns },
        h('section', { style: surveyCard },
          h('div', { style: { ...actionsStyle, alignItems: 'center', justifyContent: 'space-between' } },
            h('h2', null, '受访角色'),
            action('批量管理', onManageRoles)),
          roles.slice(first, first + 10).map((role, slot) => {
            const index = first + slot
            return h('fieldset', { key: role.id, style: surveyCard },
            h('legend', null, '角色 ' + (index + 1)),
            field('角色名称', surveyInput(role.name, name => updateItem(setRoles, index, { name }), { maxLength: 64 })),
            field('分组', surveyInput(role.group, group => updateItem(setRoles, index, { group }), { maxLength: 64 })),
            field('角色背景', surveyText(role.background, background => updateItem(setRoles, index, { background }), 2, 1800)),
            action('移除角色', () => remove(setRoles, index), roles.length === 1))
          }),
          roles.length > 10 && h('div', { style: actionsStyle },
            action('上一页', () => setPage(first / 10 - 1), first === 0),
            h('span', null, (first + 1) + '–' + Math.min(first + 10, roles.length) + ' / ' + roles.length),
            action('下一页', () => setPage(first / 10 + 1), first + 10 >= roles.length)),
          action('添加角色', () => {
            setPage(Math.floor(roles.length / 10))
            setRoles(items => [...items, { id: crypto.randomUUID(), name: '', group: '', background: '' }])
          })),
        h('section', { style: surveyCard },
          h('h2', null, '问卷题目'),
          questions.map((question, index) => h('fieldset', { key: question.id, style: surveyCard },
            h('legend', null, '第 ' + (index + 1) + ' 题'),
            field('题干', surveyInput(question.text, text => updateItem(setQuestions, index, { text }), { required: true, maxLength: 800 })),
            field('题型', h('select', {
              style: selectStyle, value: question.options ? 'single' : 'open',
              onChange: event => updateItem(setQuestions, index, { options: event.target.value === 'single' ? ['', ''] : null }),
            }, h('option', { value: 'single' }, '单选题'), h('option', { value: 'open' }, '开放题'))),
            question.options && h(React.Fragment, null,
              question.options.map((option, position) => h('div', { key: position, style: surveyField },
                field('选项 ' + (position + 1), surveyInput(option, value => updateItem(setQuestions, index, {
                  options: question.options.map((old, slot) => slot === position ? value : old),
                }), { required: true, maxLength: 200 })),
                question.options.length > 2 && action('移除选项 ' + (position + 1), () => updateItem(setQuestions, index, {
                  options: question.options.filter((_, slot) => slot !== position),
                })))),
              action('添加选项', () => updateItem(setQuestions, index, { options: [...question.options, ''] }), question.options.length === 12)),
            action('移除题目', () => remove(setQuestions, index), questions.length === 1))),
          action('添加题目', () => setQuestions(items => [...items, {
            id: crypto.randomUUID(), text: '', options: ['', ''],
          }]), questions.length === 12)))
    }

    function CalibrationForm({ result, runId, cohort, saved, onSaved }) {
      const questions = result.questions.filter(question => question.options.length)
      const [source, setSource] = useState(saved?.source ?? '')
      const [total, setTotal] = useState(saved ? String(saved.total) : '')
      const [counts, setCounts] = useState(() => Object.fromEntries(
        (saved?.rows ?? []).map(row => [row.id, row.counts.map(String)]),
      ))
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')
      const jobs = result.jobs.filter(job => cohort === null || job.group === cohort)
      async function save(event) {
        event.preventDefault()
        setBusy(true)
        setNotice('')
        setError('')
        try {
          const rows = questions.filter(question => counts[question.id]?.some(value => value !== ''))
            .map(question => ({ id: question.id, counts: counts[question.id].map(Number) }))
          await call('/simulation/calibration', { id: runId, cohort, source, total: Number(total), rows })
          setNotice('真人数据已保存')
          onSaved()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }
      if (!questions.length) return h('p', null, '本次问卷只有开放题。可在「模拟结果」查看原文。')
      return h('div', { style: surveyColumns },
        h('form', { style: surveyCard, onSubmit: save },
          h('h2', null, '录入真人数据'),
          field('数据来源', surveyInput(source, setSource, { required: true, maxLength: 120, placeholder: '例如 11 月校园问卷' })),
          field('样本总人数', surveyInput(total, setTotal, { type: 'number', required: true, min: 1, max: 1000000 })),
          h('p', null, '按题填写各选项人数。少于样本总人数的部分计为缺答，整题留空表示暂无数据。'),
          questions.map(question => h('fieldset', { key: question.id, style: surveyCard },
            h('legend', null, question.text),
            question.options.map((option, index) => h(React.Fragment, { key: option }, field(option, surveyInput(
              counts[question.id]?.[index] ?? '', value => setCounts(old => ({
                ...old, [question.id]: question.options.map((_, slot) => slot === index ? value : old[question.id]?.[slot] ?? ''),
              })), { type: 'number', min: 0, max: 1000000 },
            )))))),
          h(Button, { type: 'submit', variant: 'primary', disabled: busy }, '保存并对比'),
          errorMessage(error), notice && h('p', { role: 'status' }, notice)),
        h('section', { style: surveyCard },
          h('h2', null, '真人与模拟对比'),
          h('p', null, saved ? '真人数据 · ' + saved.source : '未校准 · 录入真人数据后对比'),
          questions.map(question => {
            const human = saved?.rows.find(row => row.id === question.id)
            const valid = human?.counts.reduce((sum, count) => sum + count, 0) ?? 0
            const answers = jobs.filter(job => job.status === 'done')
              .map(job => job.answers.find(answer => answer.id === question.id)?.answer)
              .filter(answer => question.options.includes(answer))
            const rows = question.options.map((option, index) => {
              const real = valid ? human.counts[index] * 100 / valid : null
              const simulated = answers.length ? answers.filter(answer => answer === option).length * 100 / answers.length : null
              const delta = real !== null && simulated !== null ? simulated - real : null
              const percent = value => value === null ? '—' : value.toFixed(1) + '%'
              return h('tr', { key: option }, h('th', { scope: 'row' }, option), h('td', null, percent(real)),
                h('td', null, percent(simulated)), h('td', null, delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(1)))
            })
            return h('section', { key: question.id, style: surveyCard },
              h('h3', null, question.text),
              h('p', null, '有效答卷 · 真人 ' + (human ? valid + '/' + saved.total : '—') + ' · 模拟 ' + answers.length + '/' + jobs.length),
              h('table', { style: { width: '100%', textAlign: 'left', fontVariantNumeric: 'tabular-nums' } },
                h('thead', null, h('tr', null, ['选项', '真人', '模拟', '差值（百分点）'].map(label => h('th', { key: label, scope: 'col' }, label)))),
                h('tbody', null, rows)))
          })))
    }

    function SimulationPanel() {
      const [title, setTitle] = useState('医患用药沟通调查')
      const [material, setMaterial] = useState(sampleMaterial)
      const [roles, setRoles] = useState(sampleRoles)
      const [questions, setQuestions] = useState(sampleQuestions)
      const [tab, setTab] = useState('draft')
      const [cohort, setCohort] = useState(null)
      const [questionnaireId, setQuestionnaireId] = useState('')
      const [questionnaireMenu, setQuestionnaireMenu] = useState(false)
      const [importOpen, setImportOpen] = useState(false)
      const [importFile, setImportFile] = useState(null)
      const [importError, setImportError] = useState('')
      const [notice, setNotice] = useState('')
      const batches = useSurveyLibrary('batches')
      const questionnaires = useSurveyLibrary('questionnaires')
      const [models, setModels] = useState(null)
      const [model, setModel] = useState('')
      const [concurrency, setConcurrency] = useState('6')
      const [runs, setRuns] = useState([])
      const [id, setId] = useState('')
      const [result, setResult] = useState(null)
      const [refresh, setRefresh] = useState(0)
      const [answerPage, setAnswerPage] = useState(0)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        let live = true
        const fail = failure => { if (live) setError(failure.message) }
        call('/simulation/models').then(value => {
          if (!live) return
          setModels(value)
          if (value.length) setModel('0')
        }, fail)
        call('/simulation/runs').then(value => {
          if (!live) return
          setRuns(value)
          setId(current => current || value[0]?.id || '')
        }, fail)
        return () => { live = false }
      }, [])

      useEffect(() => {
        if (!id) return
        let live = true
        let timer
        async function poll() {
          try {
            const value = await call('/simulation/result?id=' + encodeURIComponent(id))
            if (!live) return
            setResult(value)
            if (value.jobs.some(job => job.status === 'queued' || job.status === 'running')) timer = setTimeout(poll, 1200)
          } catch (failure) {
            if (live) setError(failure.message)
          }
        }
        void poll()
        return () => { live = false; clearTimeout(timer) }
      }, [id, refresh])

      async function start(event) {
        event.preventDefault()
        if (!models?.[model] || busy) return
        setBusy(true)
        setError('')
        try {
          const task = { title, material, ...models[model], roles, questions, concurrency: Number(concurrency) }
          const run = await call('/simulation/run', task)
          setRuns(previous => [{ id: run.id, title: title.trim() }, ...previous].slice(0, 30))
          setResult(null)
          setId(run.id)
          setAnswerPage(0)
          setCohort(null)
          setTab('results')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      async function retry(role) {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await call('/simulation/retry', { id, role })
          setRefresh(value => value + 1)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      async function manageQuestionnaire(operation) {
        if (busy) return
        setBusy(true)
        setError('')
        setNotice('')
        try { await operation() } catch (failure) { setError(failure.message) }
        finally { setBusy(false) }
      }
      function applyQuestionnaire(draft, id = '') {
        setQuestionnaireId(id)
        setTitle(draft.title)
        setMaterial(draft.material)
        setQuestions(draft.questions.map(question => ({
          ...question, options: question.options?.length ? question.options : null,
        })))
      }
      function openQuestionnaire(id) {
        if (!id) {
          setQuestionnaireId('')
          setNotice('')
          return
        }
        void manageQuestionnaire(async () => {
          const saved = await questionnaires.read(id)
          applyQuestionnaire(saved, saved.id)
        })
      }
      function saveQuestionnaire(id) {
        void manageQuestionnaire(async () => {
          const saved = await questionnaires.save({ id, title, material, questions })
          setQuestionnaireId(saved.id)
          await questionnaires.refresh()
          setNotice('问卷已保存')
        })
      }

      function chooseQuestionnaire(id) {
        setQuestionnaireMenu(false)
        if (id !== createOption) {
          if (id !== (questionnaireId || normalOption)) openQuestionnaire(id === normalOption ? '' : id)
          return
        }
        setQuestionnaireId('')
        setTitle('')
        setMaterial('')
        setQuestions([{ id: crypto.randomUUID(), text: '', options: ['', ''] }])
        setNotice('')
        setError('')
      }

      function showQuestionnaireImport() {
        setImportFile(null)
        setImportError('')
        setImportOpen(true)
      }

      async function importQuestionnaire() {
        if (!importFile || busy) return
        setBusy(true)
        setImportError('')
        try {
          const draft = await readQuestionnaireFile(importFile)
          const checked = await call('/simulation/questionnaires/validate', draft)
          applyQuestionnaire(checked)
          setImportOpen(false)
          setError('')
          setNotice('已导入 ' + checked.questions.length + ' 道题，可编辑后保存')
        } catch (failure) {
          setImportError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const done = result?.jobs.filter(job => job.status === 'done' || job.status === 'failed').length ?? 0
      const chooseRun = event => {
        setResult(null)
        setAnswerPage(0)
        setCohort(null)
        setId(event.target.value)
      }
      const groups = [...new Set(result?.jobs.map(job => job.group))]
      const activeCalibration = result?.calibration.find(item => item.cohort === cohort)
      const questionnaireLabel = questionnaires.items.find(item => item.id === questionnaireId)?.title ?? '当前草稿'
      return h('main', { style: { minWidth: 0, width: '100%', height: '100%', overflow: 'auto', boxSizing: 'border-box' } },
        h('div', { style: { maxWidth: 1180, padding: '24px clamp(14px, 3vw, 36px)', margin: '0 auto', display: 'grid', gap: 18 } },
          h('header', { style: surveyField },
            h('h1', { style: { margin: 0, fontSize: 28 } }, '问卷调查'),
            h('p', { style: { margin: 0 } }, '编辑问卷和受访角色，运行模拟，再用真人答卷校准。')),
          h('nav', { 'aria-label': '问卷调查', style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            [['draft', '问卷设计'], ['students', '学生批次'], ['results', '模拟结果'], ['calibration', '校准']].map(([value, label]) => h(Button, {
              key: value, type: 'button', size: 'sm', variant: tab === value ? 'primary' : 'outline',
              'aria-current': tab === value ? 'page' : undefined, onClick: () => setTab(value),
            }, label))),
          errorMessage(error || questionnaires.error),
          tab === 'students' && h(StudentBatches, { library: batches, onApply: students => {
            setRoles(students)
            setNotice('已载入 ' + students.length + ' 名学生')
            setTab('draft')
          } }),
          tab === 'draft' && h('form', { onSubmit: start, style: { display: 'grid', gap: 18 } },
            h('section', { style: surveyCard },
              h('h2', null, '基本设置'),
              h('div', { style: { ...actionsStyle, alignItems: 'end' } },
                h('div', { style: surveyField },
                  h('span', null, '已保存问卷'),
                  h(Menu, {
                    open: questionnaireMenu, onClose: () => setQuestionnaireMenu(false),
                    onSelect: chooseQuestionnaire, selectedId: questionnaireId || normalOption, align: 'start', portal: true,
                    items: [
                      { id: normalOption, label: '当前草稿' },
                      { id: createOption, label: '新建空白问卷', icon: h(IconPlusOutlineRegular, { size: 16, 'aria-hidden': true }) },
                      ...questionnaires.items.map(item => ({ id: item.id, label: item.title + ' · ' + item.count + ' 题' })),
                    ],
                    anchor: h(Button, {
                      size: 'sm', type: 'button', variant: 'outline', disabled: busy,
                      'aria-label': '已保存问卷：' + questionnaireLabel, 'aria-haspopup': 'menu',
                      'aria-expanded': questionnaireMenu, onClick: () => setQuestionnaireMenu(open => !open),
                    }, h('span', { style: { ...labelStyle, maxWidth: '14em' } }, questionnaireLabel),
                    h(IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true })),
                  })),
                action('导入问卷', showQuestionnaireImport, busy),
                action(questionnaireId ? '保存修改' : '保存问卷', () => saveQuestionnaire(questionnaireId), busy),
                questionnaireId && action('另存为新问卷', () => saveQuestionnaire(''), busy),
                questionnaireId && action('删除问卷', () => {
                  if (window.confirm('删除选中的已保存问卷？')) void manageQuestionnaire(async () => {
                    await questionnaires.remove(questionnaireId)
                    setQuestionnaireId('')
                    await questionnaires.refresh()
                    setNotice('已删除保存的问卷')
                  })
                }, busy)),
              notice && h('p', { role: 'status' }, notice),
              h('div', { style: surveyColumns },
                field('问卷名称', surveyInput(title, setTitle, { maxLength: 100, required: true })),
                field('运行模型', h('select', {
              value: model, onChange: event => setModel(event.target.value), style: selectStyle,
            },
            h('option', { value: '', disabled: true }, models === null ? '正在加载模型…' : models.length ? '选择模型' : '请先在 DSH 配置模型'),
            (models ?? []).map((item, index) => h('option', { key: item.provider + '/' + item.model, value: String(index) }, item.label + ' · ' + item.provider))))),
              field('公共材料', surveyText(material, setMaterial, 3, 6000)),
              field('并行作答数', surveyInput(concurrency, setConcurrency, { type: 'number', required: true, min: 1, max: 12, step: 1 })),
              h('div', { style: actionsStyle },
                h(Button, { type: 'submit', variant: 'primary', disabled: busy || !models?.[model] }, busy ? '处理中…' : '运行问卷'),
                h('span', null, roles.length + ' 个角色 · ' + questions.length + ' 道题'))),
            h(SurveyEditors, { roles, setRoles, questions, setQuestions, onManageRoles: () => setTab('students') })),
          (tab === 'results' || tab === 'calibration') && (runs.length ? h('div', { style: actionsStyle },
            field('运行记录', h('select', { value: id, style: { ...selectStyle, maxWidth: '100%' }, disabled: busy, onChange: chooseRun },
              runs.map(run => h('option', { key: run.id, value: run.id },
                run.title + (run.created ? ' · ' + new Date(run.created).toLocaleString() : ' · 刚刚'))))),
            tab === 'calibration' && result && field('对比分组', h('select', {
              value: cohort === null ? '' : String(groups.indexOf(cohort)),
              style: selectStyle, onChange: event => setCohort(event.target.value === '' ? null : groups[Number(event.target.value)]),
            }, h('option', { value: '' }, '全部角色'),
            groups.map((group, index) => h('option', { key: group, value: String(index) }, group || '未分组')))))
            : h('section', { style: surveyCard },
              h('p', null, tab === 'calibration' ? '先运行问卷，再录入该次运行对应的真人数据。' : '运行问卷后查看结果。'),
              action('前往问卷设计', () => setTab('draft')))),
          tab === 'results' && result && h('section', { style: surveyCard },
              h('div', { style: { ...actionsStyle, alignItems: 'center', justifyContent: 'space-between' } },
                h('h2', null, '逐人答卷'),
                action('导出答卷 CSV', () => downloadSurveyResults(result))),
              h('label', null, '已处理 ' + done + ' / ' + result.jobs.length,
                h('progress', { value: done, max: result.jobs.length, style: textareaStyle })),
              h('p', null, '并行上限 ' + result.concurrency + ' · 正在作答 ' + result.jobs.filter(job => job.status === 'running').length),
              action('前往校准', () => setTab('calibration')),
              result.jobs.length > 20 && h('div', { style: actionsStyle },
                action('上一页答卷', () => setAnswerPage(page => page - 1), answerPage === 0),
                h('span', null, (answerPage * 20 + 1) + '–' + Math.min((answerPage + 1) * 20, result.jobs.length) + ' / ' + result.jobs.length),
                action('下一页答卷', () => setAnswerPage(page => page + 1), (answerPage + 1) * 20 >= result.jobs.length)),
              result.jobs.slice(answerPage * 20, (answerPage + 1) * 20).map(job => h('details', { key: job.role },
                h('summary', null, [job.name, job.group, jobStatus[job.status]].filter(Boolean).join(' · ')),
                job.error && h('p', null, job.error),
                job.status === 'failed' && h(Button, {
                  type: 'button', size: 'sm', variant: 'outline', disabled: busy, onClick: () => retry(job.role),
                }, '重试此角色'),
                job.answers.map(item => h('div', { key: item.id },
                  h('strong', null, result.questions.find(question => question.id === item.id)?.text),
                  h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, item.answer ?? '缺答'))))),
            ),
          tab === 'calibration' && result && h(CalibrationForm, {
            key: JSON.stringify([id, cohort]), result, runId: id, cohort, saved: activeCalibration,
            onSaved: () => setRefresh(value => value + 1),
          }),
          importOpen && h(Modal, {
            title: '导入问卷', closeLabel: '关闭', open: true,
            onClose: () => { if (!busy) setImportOpen(false) },
            footer: h(React.Fragment, null,
              action('取消', () => setImportOpen(false), busy),
              h(Button, { type: 'button', variant: 'primary', disabled: !importFile || busy, onClick: importQuestionnaire }, '导入到新草稿')),
          }, h('div', { style: { display: 'grid', gap: 12 } },
            h('p', null, '支持 Markdown（.md）、JSON 和 TSV。'),
            h('details', null, h('summary', null, 'Markdown 格式示例'),
              h('pre', { style: { whiteSpace: 'pre-wrap' } }, [
                '# 医患用药沟通调查', '', '## 公共材料', '这是虚构的门诊沟通场景。', '',
                '## 题目', '### 1. 用药说明是否清楚？', '- 清楚', '- 有疑问', '',
                '### 2. 还有哪些疑问？',
              ].join('\n'))),
            h('p', null, 'TSV 使用「题干、题型、选项」三列，单选题选项用 | 分隔。开放题留空。'),
            h('p', null, '导入会替换当前编辑区，保存后可在问卷列表找到。'),
            field('问卷文件', h('input', { type: 'file', accept: '.md,.json,.tsv', disabled: busy,
              onChange: event => { setImportFile(event.target.files[0] ?? null); setImportError('') } })),
            errorMessage(importError))),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const ns = 'persona-continuity'
        ctx.effect(() => ctx.locale.register(ns, dictionaries))
        const t = ctx.locale.bind(ns)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: ns, order: 32, label: () => t('title'), locale: ns,
        }, props => h(Settings, { ...props, t })))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: ns, order: 32, locale: ns,
        }, props => h(Picker, { key: String(props.sessionId ?? ''), ...props, t })))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: simulationPanel,
        }, SimulationPanel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: simulationPanel, order: 21, label: () => '模拟任务',
        }, props => h(IconListPenOutlineRegular, { ...props, 'aria-hidden': true })))
      },
    }
  },
})
