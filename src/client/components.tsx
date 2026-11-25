import { useEffect, useRef, useState } from 'react';

export function useAction() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });

  async function run(work: () => Promise<string>) {
    setPending(true);
    setStatus({ text: '', error: false });
    try {
      setStatus({ text: await work(), error: false });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : 'Не удалось выполнить действие.', error: true });
    } finally {
      setPending(false);
    }
  }

  return { pending, status, run };
}

export function Status({ text, error }: { text: string; error?: boolean }) {
  return <p className="status" role="status" data-error={error ? '' : undefined}>{text}</p>;
}

const icons = {
  editor: 'M4 6h16v12H4zM8 10h8M8 14h5',
  edit: 'm15 5 4 4M5 19l4-.8L20 7a2.8 2.8 0 0 0-4-4L5.8 15z',
  delete: 'M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v6m4-6v6',
};

export function IconButton({ icon, label, onClick, disabled }: {
  icon: keyof typeof icons; label: string; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className={icon === 'delete' ? 'icon-button danger' : 'icon-button'}
    title={label} aria-label={label} onClick={onClick} disabled={disabled}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[icon]} /></svg>
  </button>;
}

function fenced(content: string, language = '') {
  const longest = (content.match(/\x60+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '\x60'.repeat(Math.max(3, longest + 1));
  return [fence + language, content, fence].join('\n');
}

export function PromptDialog({ prompt, onClose }: { prompt: { system: string; user: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = useAction();
  const markdown = [
    '## Системный промпт', fenced(prompt.system),
    '## Пользовательский запрос', fenced(prompt.user, 'json'),
  ].join('\n\n');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return <dialog ref={dialog} aria-labelledby="prompt-preview-title" onClose={onClose}>
    <header>
      <h2 id="prompt-preview-title">Запрос к модели</h2>
      <form method="dialog"><button autoFocus>Закрыть</button></form>
    </header>
    <p className="hint">Markdown. Запрос не отправлен провайдеру.</p>
    <pre id="prompt-markdown" tabIndex={0}>{markdown}</pre>
    <button className="primary" type="button" disabled={copy.pending} onClick={() => void copy.run(async () => {
      await navigator.clipboard.writeText(markdown);
      return 'Скопировано.';
    })}>Копировать Markdown</button>
    <Status {...copy.status} />
  </dialog>;
}
