import { useRef, useState, type FormEvent } from 'react';
import { api, type Profile } from './api';
import { IconButton, Status, useAction } from './components';

export function Personas({ personas, fields, onUse, onSaved, onDeleted }: {
  personas: Profile[]; fields: Record<string, string>;
  onUse: (id: string) => void; onSaved: (profile: Profile) => void; onDeleted: (id: string) => void;
}) {
  const [active, setActive] = useState(personas[0]?.id ?? '');
  const action = useAction();
  const form = useRef<HTMLFormElement>(null);
  const selected = personas.find(item => item.id === active);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void action.run(async () => {
      const profile = await api<Profile>('persona', { id: active, ...data });
      onSaved(profile);
      setActive(profile.id);
      return 'Профиль сохранён.';
    });
  }

  function remove(item: Profile) {
    if (!window.confirm('Удалить персонажа «' + item.name + '»? Сохранённые черновики останутся в истории.')) return;
    void action.run(async () => {
      await api('persona/delete', { id: item.id });
      onDeleted(item.id);
      if (active === item.id) setActive('');
      return 'Персонаж удалён.';
    });
  }

  return <>
    <header><h1>Персонажи</h1><button type="button" disabled={action.pending} onClick={() => {
      setActive('');
      requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[name=name]')?.focus());
    }}>Новый персонаж</button></header>
    <div className="workspace">
      <div className="card">
        {!personas.length && 'Сохранённых персонажей пока нет.'}
        {personas.map(item => <div className="entry" key={item.id}>
          <span>{item.name}</span>
          <div className="persona-actions">
            <IconButton icon="editor" label="В редактор" onClick={() => onUse(item.id)} />
            <IconButton icon="edit" label="Редактировать" disabled={action.pending} onClick={() => setActive(item.id)} />
            <IconButton icon="delete" label="Удалить" disabled={action.pending} onClick={() => remove(item)} />
          </div>
        </div>)}
      </div>
      <form ref={form} className="card" onSubmit={save}>
        <h2>Профиль</h2>
        <fieldset key={active} disabled={action.pending}>
          {Object.entries(fields).map(([name, caption]) => <label key={name}>{caption}
            {name === 'name'
              ? <input name={name} required maxLength={100} defaultValue={selected?.name ?? ''} />
              : <textarea name={name} rows={2} maxLength={12000} defaultValue={String(selected?.[name] ?? '')} />}
          </label>)}
          <button className="primary">Сохранить профиль</button>
        </fieldset>
        <Status {...action.status} />
      </form>
    </div>
  </>;
}
