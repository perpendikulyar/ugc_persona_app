import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getCACertificates } from 'node:tls';
import { Agent, fetch as undiciFetch, type RequestInit } from 'undici';

let dispatcher: Agent | undefined;

export function gigachatTls() {
  const certificate = readFileSync(new URL('../certs/russian-trusted-root-ca.pem', import.meta.url), 'utf8');
  return { ca: [...getCACertificates('default'), certificate] };
}

export function gigachatFetch(url: string, options: RequestInit) {
  if (!dispatcher) {
    dispatcher = new Agent({ connect: gigachatTls() });
  }
  return undiciFetch(url, { ...options, dispatcher, redirect: 'error' });
}

let cached: { token: string; expiresAt: number } | undefined;
let pending: Promise<string> | undefined;

async function requestToken(key: string, send: typeof gigachatFetch) {
  let response: Awaited<ReturnType<typeof gigachatFetch>>;
  try {
    response = await send('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + key,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        RqUID: randomUUID(),
      },
      body: new URLSearchParams({ scope: process.env.GIGACHAT_SCOPE?.trim() || 'GIGACHAT_API_PERS' }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Сервер авторизации GigaChat недоступен. Проверьте соединение и сертификат Минцифры.');
  }

  if (!response.ok) {
    throw new Error(`Авторизация GigaChat вернула HTTP ${response.status}. Проверьте ключ авторизации и scope.`);
  }
  const data = await response.json();
  if (typeof data.access_token !== 'string' || !data.access_token.trim()) {
    throw new Error('GigaChat не вернул токен доступа.');
  }
  const expiry = Number(data.expires_at);
  const expiresAt = expiry < 1e12 ? expiry * 1000 : expiry;
  cached = { token: data.access_token, expiresAt };
  return cached.token;
}

export function gigachatToken(key: string, send = gigachatFetch) {
  if (cached && cached.expiresAt > Date.now() + 60_000) return Promise.resolve(cached.token);
  pending ??= requestToken(key, send).finally(() => { pending = undefined; });
  return pending;
}

export function invalidateGigachatToken(token: string) {
  if (cached?.token === token) cached = undefined;
}
