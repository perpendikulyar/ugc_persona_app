import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type Draft, type GenerationRequest, type Workspace } from './api';
import { Status, useAction } from './components';
import { Editor } from './editor';
import { Personas } from './personas';
import { ProxyAddress } from './proxy';

const sections = { editor: 'Редактор', personas: 'Персонажи', history: 'История', settings: 'Настройки' } as const;
type Section = keyof typeof sections;

function initialProvider(providers: Workspace['providers'], defaultProvider: string) {
  const ready = providers.filter(item => item.ready);
  return ready.find(item => item.id === defaultProvider)?.id ?? ready[0]?.id ?? '';
}

function Settings({ providers, defaultProvider, onDefaultSaved, proxyEnabled, proxyAddress, onProxySaved, onProxyAddressSaved }: {
  onProxyAddressSaved: (settings: Pick<Workspace, 'proxyEnabled' | 'proxyAddress'>) => void;
  proxyAddress: string; proxyEnabled: boolean; onProxySaved: (enabled: boolean) => void;
  providers: Workspace['providers']; defaultProvider: string; onDefaultSaved: (id: string) => void;
}) {
  const check = useAction();
  const proxy = useAction();
  const proxyConfigured = Boolean(proxyAddress);
  const save = useAction();
  const [selection, setSelection] = useState(defaultProvider);
  const ready = providers.filter(item => item.ready);
  const unavailable = Boolean(defaultProvider && !ready.some(item => item.id === defaultProvider));
  return <>
    <header><h1>Настройки</h1></header>
    <form className="card mb-5" onSubmit={event => {
      event.preventDefault();
      void save.run(async () => {
        const result = await api<{ defaultProvider: string }>('settings/default-provider', { provider: selection });
        onDefaultSaved(result.defaultProvider);
        return 'Настройка сохранена.';
      });
    }}>
      <label>Модель по умолчанию
        <select value={selection} disabled={save.pending || (!ready.length && !defaultProvider)}
          onChange={event => setSelection(event.target.value)}>
          <option value="">{ready.length ? 'Автоматически' : 'Модели не настроены'}</option>
          {unavailable && <option value={defaultProvider} disabled>
            {(providers.find(item => item.id === defaultProvider)?.name ?? defaultProvider) + ' · не настроено'}
          </option>}
          {ready.map(item => <option key={item.id} value={item.id}>{item.name + ' · ' + item.model}</option>)}
        </select>
      </label>
      <button className="primary" disabled={save.pending || selection === defaultProvider}>Сохранить</button>
      <Status {...save.status} />
    </form>
    <div className="card mb-5">
      <h2>Исходящий прокси</h2>
      <label className="check">
        <input type="checkbox" checked={proxyEnabled} disabled={proxy.pending || check.pending || (!proxyConfigured && !proxyEnabled)}
          onChange={event => {
            const enabled = event.target.checked;
            void proxy.run(async () => {
              const result = await api<{ proxyEnabled: boolean }>('settings/proxy', { enabled });
              onProxySaved(result.proxyEnabled);
              return result.proxyEnabled ? 'Прокси включён.' : 'Прокси выключен.';
            });
          }} />
        {proxyEnabled ? 'Вкл' : 'Выкл'}
      </label>
      <p className="hint">{proxyConfigured
        ? 'При включении все провайдеры используют этот адрес.'
        : 'Укажите и сохраните общий адрес прокси.'}</p>
      <Status {...proxy.status} />
      <ProxyAddress savedAddress={proxyAddress} onSaved={onProxyAddressSaved} />
    </div>
    <div className="card">
      <h2>Подключения</h2>
      <p className="hint">Ключи и идентификаторы моделей задаются на компьютере в файле .env.</p>
      {providers.map(item => <div className="entry" key={item.id}>
        <span>{item.name + (item.ready ? ' · ' + item.model + (proxyEnabled ? ' · через прокси' : ' · напрямую') : ' · требуется настройка')}</span>
        <button type="button" disabled={!item.ready || check.pending || proxy.pending} onClick={() => void check.run(async () => {
          await api('probe', { provider: item.id });
          return item.name + ' отвечает.';
        })}>Проверить</button>
      </div>)}
      <Status {...check.status} />
    </div>
  </>;
}

function App({ initial }: { initial: Workspace }) {
  const [workspace, setWorkspace] = useState(initial);
  const [section, setSection] = useState<Section>('editor');
  const [draft, setDraft] = useState<Draft>();
  const [request, setRequest] = useState<GenerationRequest>({
    persona: initial.personas[0]?.id ?? '',
    provider: initialProvider(initial.providers, initial.defaultProvider),
    mode: 'reply', task: '', context: '', target: '', refinement: '',
  });

  function openHistory(item: Draft) {
    if (draft?.id !== item.id && (request.task || request.context || draft) &&
        !window.confirm('Открытие черновика заменит данные в редакторе. Продолжить?')) return;
    setRequest({
      persona: workspace.personas.some(person => person.id === item.persona) ? item.persona : '',
      provider: workspace.providers.some(model => model.id === item.provider && model.ready) ? item.provider : request.provider,
      mode: item.mode, task: item.task, context: item.context, target: item.target, refinement: item.refinement,
    });
    setDraft(item);
    setSection('editor');
  }

  return <>
    <aside>
      <a className="brand" href="/">UGC <span>Persona</span></a>
      <nav aria-label="Разделы">
        {(Object.keys(sections) as Section[]).map(key => <button type="button" key={key}
          aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>{sections[key]}</button>)}
      </nav>
    </aside>
    <main>
      <section hidden={section !== 'editor'}>
        <Editor workspace={workspace} request={request} setRequest={setRequest} draft={draft} openDraft={setDraft}
          onSave={item => setWorkspace(current => ({ ...current, drafts: [item, ...current.drafts.filter(row => row.id !== item.id)] }))} />
      </section>
      <section hidden={section !== 'personas'}>
        <Personas personas={workspace.personas} fields={workspace.fields}
          onUse={id => { setRequest(current => ({ ...current, persona: id })); setSection('editor'); }}
          onSaved={profile => {
            setWorkspace(current => ({
              ...current,
              personas: current.personas.some(item => item.id === profile.id)
                ? current.personas.map(item => item.id === profile.id ? profile : item)
                : [...current.personas, profile],
            }));
            setRequest(current => current.persona ? current : { ...current, persona: profile.id });
          }}
          onDeleted={id => {
            setWorkspace(current => ({ ...current, personas: current.personas.filter(item => item.id !== id) }));
            setRequest(current => current.persona === id ? { ...current, persona: '' } : current);
          }} />
      </section>
      <section hidden={section !== 'history'}>
        <header><h1>История</h1></header>
        <div className="card">
          {!workspace.drafts.length && 'Сохранённых черновиков пока нет.'}
          {workspace.drafts.map(item => <div className="entry" key={item.id}>
            <span>{item.personaName + ' · ' + (item.edited?.title || item.edited?.text || item.original.text).slice(0, 110)}</span>
            <button type="button" onClick={() => openHistory(item)}>Открыть</button>
          </div>)}
        </div>
      </section>
      <section hidden={section !== 'settings'}><Settings providers={workspace.providers} defaultProvider={workspace.defaultProvider}
        proxyEnabled={workspace.proxyEnabled}
        proxyAddress={workspace.proxyAddress}
        onProxyAddressSaved={settings => setWorkspace(current => ({ ...current, ...settings }))}
        onProxySaved={enabled => setWorkspace(current => ({ ...current, proxyEnabled: enabled }))}
        onDefaultSaved={id => {
          setWorkspace(current => ({ ...current, defaultProvider: id }));
          setRequest(current => ({ ...current, provider: initialProvider(workspace.providers, id) }));
        }} /></section>
    </main>
  </>;
}

function Startup() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<Workspace>('state').then(setWorkspace, () => setFailed(true));
  }, []);
  if (workspace) return <App initial={workspace} />;
  return <main><Status text={failed ? 'Не удалось загрузить приложение. Обновите страницу.' : 'Загрузка…'} error={failed} /></main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Не найден контейнер приложения.');
createRoot(root).render(<Startup />);
