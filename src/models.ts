import { setTimeout as delay } from 'node:timers/promises';
import { gigachatFetch, gigachatToken, invalidateGigachatToken } from './gigachat.ts';

const providers = [
  {
    id: 'openrouter', name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL,
  },
  {
    id: 'openai', name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL,
  },
  {
    id: 'yandex', name: 'YandexGPT',
    endpoint: 'https://ai.api.cloud.yandex.net/foundationModels/v1/completion',
    key: process.env.YANDEX_API_KEY, model: process.env.YANDEX_MODEL_URI,
  },
  {
    id: 'groq', name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL,
  },
  {
    id: 'gemini', name: 'Google AI Studio',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL,
  },
  {
    id: 'gigachat', name: 'GigaChat',
    endpoint: 'https://api.giga.chat/v1/chat/completions',
    key: process.env.GIGACHAT_AUTH_KEY, model: process.env.GIGACHAT_MODEL,
  },
];

export function models() {
  return providers.map(({ id, name, key, model }) => ({ id, name, model, ready: Boolean(key?.trim() && model?.trim()) }));
}

export async function complete(id: string, system: string, user: string, draftMode?: 'topic' | 'reply') {
  const provider = providers.find(item => item.id === id);
  if (!provider?.key?.trim() || !provider.model?.trim()) throw new Error('Настройте ключ и модель провайдера в переменных окружения.');
  const yandex = id === 'yandex';
  const giga = id === 'gigachat';
  const token = giga ? await gigachatToken(provider.key.trim()) : provider.key;
  const body = yandex ? {
    modelUri: provider.model,
    completionOptions: { stream: false, maxTokens: '2500' },
    messages: [{ role: 'system', text: system }, { role: 'user', text: user }],
  } : {
    model: provider.model,
    ...(id === 'openrouter' || id === 'gemini' || giga ? { max_tokens: 3500 } : { max_completion_tokens: 3500 }),
    ...(id === 'openai' ? { store: false } : {}),
    ...(giga && draftMode ? {
      response_format: {
        type: 'json_schema',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: draftMode === 'topic' ? 'Короткий заголовок темы' : 'Пустая строка',
            },
            text: { type: 'string', description: 'Текст черновика' },
          },
          required: ['title', 'text'],
          additionalProperties: false,
        },
      },
    } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  const send = giga ? gigachatFetch : fetch;
  const request = {
    method: 'POST',
    headers: {
      Authorization: (yandex ? 'Api-Key ' : 'Bearer ') + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  };
  let response: Awaited<ReturnType<typeof send>>;
  try {
    response = await send(provider.endpoint, request);
    if (id === 'gemini') {
      for (const backoff of [1000, 2000]) {
        if (response.status !== 503) break;
        const retryAfter = response.headers.get('Retry-After');
        const wait = retryAfter
          ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
          : 0;
        // Leave long retry intervals to the editor instead of holding the request open.
        if (wait > 10_000) break;
        await response.body?.cancel();
        await delay(Math.max(wait || 0, backoff + Math.random() * 250), undefined, { signal: request.signal });
        response = await send(provider.endpoint, request);
      }
    }
  } catch {
    throw new Error('Модель недоступна или не ответила вовремя. Повторите запрос.');
  }

  if (id === 'gemini' && response.status === 503) {
    await response.body?.cancel();
    throw new Error('Google AI Studio временно недоступен (HTTP 503). Повторите позже или выберите другую модель в редакторе.');
  }

  if (giga && response.status === 401) invalidateGigachatToken(token);
  if (!response.ok) throw new Error(`${provider.name} вернул HTTP ${response.status}. Проверьте ключ, модель и доступ к API.`);
  const data = await response.json();
  const content = yandex ? data.result?.alternatives?.[0]?.message?.text : data.choices?.[0]?.message?.content;
  const model = (id === 'openrouter' || giga) && typeof data.model === 'string' && data.model.trim() ? data.model : provider.model;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Модель не вернула текст.');
  return { content: content.trim(), model, provider: provider.id };
}
