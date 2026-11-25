import { useState, type FormEvent } from 'react';
import { api, type Draft, type GenerationRequest, type TextDraft, type Workspace } from './api';
import { PromptDialog, Status, useAction } from './components';

export function Editor({ workspace, request, setRequest, draft, openDraft, onSave }: {
  workspace: Workspace;
  request: GenerationRequest;
  setRequest: (value: GenerationRequest) => void;
  draft?: Draft;
  openDraft: (draft: Draft) => void;
  onSave: (draft: Draft) => void;
}) {
  const [debug, setDebug] = useState(false);
  const [prompt, setPrompt] = useState<{ system: string; user: string }>();
  const [edited, setEdited] = useState<TextDraft>({ title: '', text: '' });
  const [keep, setKeep] = useState(false);
  const generate = useAction();
  const output = useAction();
  const [saved, setSaved] = useState(draft?.edited ?? draft?.original);
  const [shownDraft, setShownDraft] = useState(draft);
  if (shownDraft !== draft) {
    setShownDraft(draft);
    setSaved(draft?.edited ?? draft?.original);
    setEdited(draft?.edited ?? draft?.original ?? { title: '', text: '' });
    setKeep(Boolean(draft?.updated && (draft.context || draft.target)));
  }
  const ready = workspace.providers.some(item => item.ready);
  const deleted = Boolean(draft && !workspace.personas.some(item => item.id === draft.persona));

  function change<K extends keyof GenerationRequest>(key: K, value: GenerationRequest[K]) {
    setRequest({ ...request, [key]: value });
  }

  function loadExample() {
    if ((request.task || request.context) && !window.confirm('Заменить задачу и контекст примером?')) return;
    setRequest({
      ...request,
      persona: workspace.personas.find(item => item.name === 'Хельга Патаки')?.id ?? request.persona,
      mode: 'reply', task: 'Прокомментируй в стиле персонажа, в саркастическом ключе.',
      context: workspace.exampleContext, target: '', refinement: '',
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = saved;
    if (!debug && current && (current.title !== edited.title || current.text !== edited.text) &&
        !window.confirm('Новая генерация заменит несохранённые правки. Продолжить?')) return;
    void generate.run(async () => {
      if (debug) {
        setPrompt(await api<{ system: string; user: string }>('generate', { ...request, debug: true }));
        return '';
      }
      openDraft(await api<Draft>('generate', request));
      return 'Черновик готов.';
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    void output.run(async () => {
      await api('draft', { ...draft, edited, keep });
      setSaved(edited);
      onSave({
        ...draft, edited, updated: new Date().toISOString(),
        context: keep ? draft.context : '', target: keep ? draft.target : '',
      });
      return 'Сохранено в истории.';
    });
  }

  return <>
    <header><h1>Редактор</h1><button type="button" onClick={loadExample}>Загрузить пример</button></header>
    <div className="workspace">
      <form className="card" onSubmit={submit}>
        <h2>Задача</h2>
        <div className="pair">
          <label>Персонаж<select required value={request.persona} onChange={event => change('persona', event.target.value)}>
            <option value="" disabled>{workspace.personas.length ? 'Выберите персонажа' : 'Нет персонажей'}</option>
            {workspace.personas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Тип текста<select value={request.mode} onChange={event => change('mode', event.target.value === 'topic' ? 'topic' : 'reply')}>
            <option value="reply">Ответ</option><option value="topic">Новый топик</option>
          </select></label>
        </div>
        <label>Что написать<textarea required maxLength={12000} rows={3} value={request.task}
          onChange={event => change('task', event.target.value)} placeholder="Например, ответь с сарказмом и предложи решение" /></label>
        <label>Контекст обсуждения<textarea maxLength={50000} rows={6} value={request.context}
          onChange={event => change('context', event.target.value)} placeholder="Вставьте тему и сообщения из ветки" /></label>
        {request.mode === 'reply' && <label>Реплика для ответа<textarea maxLength={12000} rows={2} value={request.target}
          onChange={event => change('target', event.target.value)} placeholder="Вставьте конкретную реплику, если нужно" /></label>}
        <label>Уточнение для генерации<input maxLength={12000} value={request.refinement}
          onChange={event => change('refinement', event.target.value)} placeholder="Например, сделай ответ короче" /></label>
        <label>Модель<select required={!debug} value={request.provider} onChange={event => change('provider', event.target.value)}>
          {!ready && <option value="" disabled>Модели не настроены</option>}
          {workspace.providers.map(item => <option key={item.id} value={item.id} disabled={!item.ready}>
            {item.name + (item.ready ? ' · ' + item.model : ' · не настроено')}
          </option>)}
        </select></label>
        <p className="hint">Задача, профиль и вставленный контекст передаются выбранному провайдеру при генерации.</p>
        <label className="check"><input type="checkbox" checked={debug} onChange={event => setDebug(event.target.checked)} /> Режим отладки</label>
        <button className="primary" disabled={generate.pending || !request.persona || (!debug && !ready)}>
          {debug ? 'Показать запрос' : draft ? 'Сгенерировать снова' : 'Создать черновик'}
        </button>
        {deleted && !request.persona && <p className="hint">Персонаж удалён. Для новой генерации выберите другой профиль.</p>}
        <Status {...(generate.pending ? { text: debug ? 'Подготовка запроса…' : 'Генерация…' } : generate.status)} />
      </form>
      <form className="card" onSubmit={save}>
        <h2>Черновик</h2>
        <p className="hint">{draft ? draft.personaName + ' · ' + draft.model : 'Здесь появится результат генерации.'}</p>
        <fieldset disabled={!draft || generate.pending || output.pending}>
          {draft?.mode === 'topic' && <label>Заголовок<input required maxLength={500} value={edited.title}
            onChange={event => setEdited({ ...edited, title: event.target.value })} /></label>}
          <label>Текст<textarea maxLength={24000} rows={12} required value={edited.text}
            onChange={event => setEdited({ ...edited, text: event.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={keep} onChange={event => setKeep(event.target.checked)} /> Сохранить контекст в истории</label>
          <div className="actions">
            <button className="primary">Сохранить</button>
            <button type="button" onClick={() => void output.run(async () => {
              await navigator.clipboard.writeText([edited.title, edited.text].filter(Boolean).join('\n\n'));
              return 'Скопировано.';
            })}>Копировать</button>
          </div>
          <details><summary>Исходная генерация</summary><pre>{draft && [draft.original.title, draft.original.text].filter(Boolean).join('\n\n')}</pre></details>
        </fieldset>
        <Status {...output.status} />
      </form>
    </div>
    {prompt && <PromptDialog prompt={prompt} onClose={() => setPrompt(undefined)} />}
  </>;
}
