import { useEffect, useState } from 'react';
import { api, type Workspace } from './api';
import { Status, useAction } from './components';

type Check = { address: string; ok: boolean; message: string };

type ProxySettings = Pick<Workspace, 'proxyEnabled' | 'proxyAddress'>;

export function ProxyAddress({ savedAddress, onSaved }: { savedAddress: string; onSaved: (settings: ProxySettings) => void }) {
  const [input, setInput] = useState(savedAddress);
  const [check, setCheck] = useState<Check>();
  const [checkingSaved, setCheckingSaved] = useState(false);
  const save = useAction();
  const address = input.trim();
  const changed = address !== savedAddress;
  const result = check?.address === address ? check : undefined;
  const checking = checkingSaved || Boolean(changed && address && !result);

  async function test(value: string): Promise<Check> {
    try {
      await api('settings/proxy/check', { address: value });
      return { address: value, ok: true, message: 'Прокси доступен.' };
    } catch (error) {
      return { address: value, ok: false, message: error instanceof Error ? error.message : 'Прокси недоступен.' };
    }
  }

  useEffect(() => {
    if (!address || !changed) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void test(address).then(value => { if (active) setCheck(value); });
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [address, changed]);

  function persist(value: string) {
    void save.run(async () => {
      const stored = await api<ProxySettings>('settings/proxy/address', {
        address: value,
      }).catch((error: Error) => {
        if (value) setCheck({ address: value, ok: false, message: error.message });
        throw error;
      });
      onSaved(stored);
      setInput(stored.proxyAddress);
      setCheck(value ? { address: stored.proxyAddress, ok: true, message: 'Прокси доступен.' } : undefined);
      return value ? 'Адрес сохранён.' : 'Адрес удалён.';
    });
  }

  return <div className="border-t border-line py-3">
    <form onSubmit={event => {
      event.preventDefault();
      if (changed && address && result?.ok && !save.pending) persist(address);
    }}>
      <label>Адрес прокси
        <input type="text" spellCheck={false} autoComplete="off" maxLength={2048} value={input} disabled={save.pending || checkingSaved}
          onChange={event => {
            const value = event.target.value;
            if (value.trim() !== address) setCheck(undefined);
            setInput(value);
          }}
          placeholder="IP:порт или HTTP/HTTPS URL" />
      </label>
      <div className="actions">
        <button type="submit" disabled={save.pending || !changed || !address || !result?.ok}>Сохранить адрес</button>
        {savedAddress && <>
          <button type="button" disabled={save.pending || checking} onClick={async () => {
            setCheckingSaved(true);
            setInput(savedAddress);
            const tested = await test('');
            setCheck({ ...tested, address: savedAddress });
            setCheckingSaved(false);
          }}>Проверить сохранённый</button>
          <button type="button" disabled={save.pending || checkingSaved} onClick={() => persist('')}>Удалить адрес</button>
        </>}
        {result && !checking && <svg className={result.ok ? 'size-5 text-green-700' : 'size-5 text-red-700'}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={result.ok ? 'm5 12 4 4L19 6' : 'm6 6 12 12M18 6 6 18'} />
        </svg>}
      </div>
    </form>
    <Status text={checking ? 'Проверка прокси…' : result?.message ?? ''} error={!checking && result?.ok === false} />
    <Status {...save.status} />
  </div>;
}
