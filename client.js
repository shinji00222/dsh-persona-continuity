window.__ModuleLoader__.load({
  id: 'dsh-persona-continuity',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const base = '/api/persona-continuity'

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
        save: '保存人格', index: '记忆索引', search: '查找记忆', forget: '删除记忆', confirm: '删除这条长期记忆？',
        empty: '暂无匹配记忆', source: '来源会话', turn: '轮次', locked: '已开始的会话沿用原人格',
      },
      en: {
        title: 'Persona Continuity', normal: 'Standard chat', persona: 'Persona', new: 'New persona', name: 'Name',
        instructions: 'Persona instructions', save: 'Save persona', index: 'Memory index', search: 'Search memories',
        forget: 'Forget', confirm: 'Delete this long-term memory?', empty: 'No matching memories', source: 'Source chat',
        turn: 'Turn', locked: 'The persona is fixed after the chat starts',
      },
    }

    const selectStyle = {
      maxWidth: '12em', color: 'inherit', background: 'var(--dsw-alias-background-primary, Canvas)',
      border: '1px solid var(--dsw-alias-border-secondary, GrayText)', borderRadius: 6, padding: '3px 6px',
    }
    const panelStyle = { display: 'grid', gap: 12, maxWidth: 720 }
    const errorMessage = error => error ? h('span', { role: 'alert' }, error) : null
    const statePath = id => '/state?session=' + encodeURIComponent(id ?? '')

    function Picker({ sessionId, t }) {
      const [state, setState] = useState(null)
      const [pending, setPending] = useState(false)
      const [error, setError] = useState('')
      useEffect(() => {
        let live = true
        const refresh = () => call(statePath(sessionId)).then(
          value => { if (live) { setState(value); setError('') } },
          failure => { if (live) setError(failure.message) },
        )
        void refresh()
        window.addEventListener('focus', refresh)
        window.addEventListener('persona-continuity:changed', refresh)
        return () => {
          live = false
          window.removeEventListener('focus', refresh)
          window.removeEventListener('persona-continuity:changed', refresh)
        }
      }, [sessionId])
      if (!sessionId || !state) return errorMessage(error)
      const select = async event => {
        setPending(true)
        try {
          setState(await call('/bind', { session: sessionId, persona: event.target.value }))
          setError('')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setPending(false)
        }
      }
      return h('span', null,
        h('select', {
          'aria-label': t('persona'), title: state.editable ? t('persona') : t('locked'),
          style: selectStyle, value: state.selected, onChange: select, disabled: pending || !state.editable,
        },
        h('option', { value: '' }, t('normal')),
        state.personas.map(persona => h('option', { key: persona.id, value: persona.id }, persona.name))),
        errorMessage(error),
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
          window.dispatchEvent(new Event('persona-continuity:changed'))
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
          h('label', null, t('name'), ' ', h('input', { value: name, required: true, maxLength: 48, onChange: e => setName(e.target.value) })),
          h('label', null, t('instructions'), h('textarea', {
            value: instructions, rows: 4, required: true, maxLength: 3500,
            style: { display: 'block', width: '100%' }, onChange: e => setInstructions(e.target.value),
          })),
          h('button', { type: 'submit', disabled: busy, style: { justifySelf: 'start' } }, t('save'))),
        errorMessage(error),
        id && h('div', { style: panelStyle },
          h('h3', null, t('index')),
          h('input', { type: 'search', 'aria-label': t('search'), placeholder: t('search'), value: query, onChange: e => setQuery(e.target.value) }),
          rows.length === 0 && h('div', null, t('empty')),
          rows.map(row => h('details', { key: row.id },
            h('summary', null, row.title, ' · ', row.summary),
            h('p', { style: { whiteSpace: 'pre-wrap' } }, row.detail),
            h('p', null, t('source'), ' ', row.session, ' · ', t('turn'), ' ', row.turn),
            h('button', { type: 'button', onClick: () => forget(row) }, t('forget'))))),
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
