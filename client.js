window.__ModuleLoader__.load({
  id: 'dsh-persona-continuity',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useId, useState } = React
    const { Button, Menu, Modal, Input, IconChevronDownOutlineRegular, IconPlusOutlineRegular } =
      require('@deepseek-ai/dsh-client-ui-primitives')
    const base = '/api/persona-continuity'
    const changedEvent = 'persona-continuity:changed'
    const normalOption = '__normal__'
    const createOption = '__create__'

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
      },
    }
  },
})
