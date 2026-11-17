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
      const headers = { 'x-dsh-persona-continuity': '1' }
      const options = { headers }
      if (data !== undefined) {
        options.method = 'POST'
        options.body = JSON.stringify(data)
        headers['content-type'] = 'application/json'
      }
      const response = await fetch(base + path, options)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '无法读取人格记忆')
      return result
    }

    const dictionaries = {
      zh: {
        title: '人格续忆', normal: '普通会话', persona: '人格', new: '新建人格', name: '名称', instructions: '人格设定',
        close: '关闭', cancel: '取消', createAndUse: '创建并使用', namePlaceholder: '输入人格名称',
        save: '保存人格', index: '记忆索引', search: '查找记忆', forget: '删除记忆', confirm: '删除这条长期记忆？',
        empty: '暂无匹配记忆', source: '来源会话', turn: '轮次', locked: '已开始的会话沿用原人格',
      },
      en: {
        title: 'Persona Continuity', normal: 'Standard chat', persona: 'Persona', new: 'New persona', name: 'Name',
        close: 'Close', cancel: 'Cancel', createAndUse: 'Create and use', namePlaceholder: 'Enter a persona name',
        instructions: 'Persona instructions', save: 'Save persona', index: 'Memory index', search: 'Search memories',
        forget: 'Forget', confirm: 'Delete this long-term memory?', empty: 'No matching memories', source: 'Source chat',
        turn: 'Turn', locked: 'The persona is fixed after the chat starts',
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

      async function create(event) {
        event.preventDefault()
        const title = name.trim()
        if (pending || !title) return
        setPending(true)
        setError('')
        try {
          setState(await call('/create', { session: sessionId, name: title }))
          setMode(null)
          window.dispatchEvent(new Event(changedEvent))
        } catch (failure) {
          setError(failure.message)
        } finally {
          setPending(false)
        }
      }

      function closeCreate() {
        if (pending) return
        setMode(null)
        setError('')
      }

      const selected = state.personas.find(persona => persona.id === state.selected)
      const label = selected?.name ?? t('normal')
      return h('div', { style: pickerStyle },
        h(Menu, {
          open: mode === 'menu',
          onClose: () => setMode(current => current === 'menu' ? null : current),
          items: [
            { id: normalOption, label: t('normal') },
            { id: createOption, label: t('new'), icon: h(IconPlusOutlineRegular, { size: 16, 'aria-hidden': true }) },
            ...state.personas.map(persona => ({ id: persona.id, label: persona.name })),
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
            disabled: pending || !state.editable,
            onClick: () => { setError(''); setMode(mode === 'menu' ? null : 'menu') },
          },
          h('span', { style: labelStyle }, label),
          h(IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true })),
        }),
        mode !== 'create' && errorMessage(error),
        h(Modal, {
          title: t('new'), closeLabel: t('close'), open: mode === 'create', onClose: closeCreate,
          footer: h(React.Fragment, null,
            h(Button, { variant: 'outline', disabled: pending, onClick: closeCreate }, t('cancel')),
            h(Button, { variant: 'primary', type: 'submit', form: formId, disabled: pending || !name.trim() }, t('createAndUse'))),
        },
        h('form', { id: formId, onSubmit: create, style: { display: 'grid', gap: 8 } },
          h(Input, {
            'aria-label': t('name'), 'data-modal-autofocus': '', placeholder: t('namePlaceholder'),
            value: name, required: true, maxLength: 48, onChange: event => setName(event.target.value),
          }),
          errorMessage(error),
        )),
      )
    }

    function Settings({ t }) {
      const [personas, setPersonas] = useState([])
      const [id, setId] = useState('')
      const [name, setName] = useState('')
      const [instructions, setInstructions] = useState('')
      const [query, setQuery] = useState('')
      const [rows, setRows] = useState([])
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let live = true
        call('/state').then(value => { if (live) setPersonas(value.personas) },
          failure => { if (live) setError(failure.message) })
        return () => { live = false }
      }, [])

      useEffect(() => {
        let live = true
        if (!id) return
        const timer = setTimeout(() => {
          call('/index?persona=' + encodeURIComponent(id) + '&q=' + encodeURIComponent(query))
            .then(value => { if (live) setRows(value) }, failure => { if (live) setError(failure.message) })
        }, 180)
        return () => { live = false; clearTimeout(timer) }
      }, [id, query])

      function choose(next) {
        const persona = personas.find(item => item.id === next)
        setId(next)
        setName(persona?.name ?? '')
        setInstructions(persona?.instructions ?? '')
        setQuery('')
        setRows([])
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

      async function forget(row) {
        if (!window.confirm(t('confirm'))) return
        try {
          await call('/forget', { persona: id, id: row.id })
          setRows(old => old.filter(item => item.id !== row.id))
          setError('')
        } catch (failure) {
          setError(failure.message)
        }
      }

      return h('section', { style: panelStyle },
        h('label', null, t('persona'), ' ', h('select', { style: selectStyle, value: id, onChange: e => choose(e.target.value) },
          h('option', { value: '' }, t('new')),
          personas.map(persona => h('option', { key: persona.id, value: persona.id }, persona.name)))),
        h('form', { onSubmit: save, style: panelStyle },
          h('label', null, t('name'), ' ', h(Input, { value: name, required: true, maxLength: 48, onChange: e => setName(e.target.value) })),
          h('label', null, t('instructions'), h('textarea', {
            value: instructions, rows: 4, maxLength: 3500,
            style: { display: 'block', width: '100%' }, onChange: e => setInstructions(e.target.value),
          })),
          h(Button, { variant: 'primary', type: 'submit', disabled: busy, style: { justifySelf: 'start' } }, t('save'))),
        errorMessage(error),
        id && h('div', { style: panelStyle },
          h('h3', null, t('index')),
          h(Input, { type: 'search', 'aria-label': t('search'), placeholder: t('search'), value: query, onChange: e => setQuery(e.target.value) }),
          rows.length === 0 && h('div', null, t('empty')),
          rows.map(row => h('details', { key: row.id },
            h('summary', null, row.title, ' · ', row.summary),
            h('p', { style: { whiteSpace: 'pre-wrap' } }, row.detail),
            h('p', null, t('source'), ' ', row.session, ' · ', t('turn'), ' ', row.turn),
            h(Button, { size: 'sm', variant: 'outline', type: 'button', onClick: () => forget(row) }, t('forget'))))),
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
