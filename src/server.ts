import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { complete, models } from './models.ts';
import { buildDraftPrompt } from './prompt.ts';
import { helga } from './helga.ts';

const path = process.env.DATABASE_PATH || './data/persona.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path, { timeout: 5000 });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY
  ) STRICT;
  CREATE TABLE IF NOT EXISTS deleted_personas (
    id TEXT PRIMARY KEY REFERENCES personas(id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS profiles (
    persona TEXT NOT NULL REFERENCES personas(id),
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (persona, version)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    persona TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated TEXT NOT NULL,
    FOREIGN KEY (persona, version) REFERENCES profiles(persona, version)
  ) STRICT;
`);

const fields = {
  name: 'Имя или ник',
  bio: 'Биография',
  traits: 'Характер и ценности',
  interests: 'Интересы и опыт',
  behavior: 'Поведение в разных ситуациях',
  style: 'Стиль речи',
  limits: 'Оформление и стоп-лист',
  topicLength: 'Длина топика',
  replyLength: 'Длина ответа',
  examples: 'Примеры реплик',
};

type Input = Record<string, unknown>;
function field(input: Input, key: string, limit = 12000, required = false) {
  const value = input[key] ?? '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim()))
    throw new Error(`Проверьте поле «${fields[key as keyof typeof fields] ?? key}».`);
  return value.trim();
}

function profile(id: string) {
  const row = db.prepare(`SELECT * FROM profiles WHERE persona = ?
    AND NOT EXISTS (SELECT 1 FROM deleted_personas WHERE id = profiles.persona)
    ORDER BY version DESC LIMIT 1`).get(id);
  if (!row) throw new Error('Персонаж не найден.');
  return { id, version: Number(row.version), ...JSON.parse(String(row.data)) };
}

function saveProfile(id: string, data: Input) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT id FROM deleted_personas WHERE id = ?').get(id)) throw new Error('Персонаж удалён.');
    db.prepare('INSERT OR IGNORE INTO personas (id) VALUES (?)').run(id);
    // Keep existing profile keys so drafts in older databases remain linked.
    db.prepare(`INSERT INTO profiles (persona, version, data)
      SELECT ?, COALESCE(MAX(version), 1), ? FROM profiles WHERE persona = ?
      ON CONFLICT(persona, version) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(data), id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return profile(id);
}

const example = readFileSync(new URL('../examples/РОЛЬ И ЛИЧНОСТЬ.md', import.meta.url), 'utf8');
const exampleContext = example.split('КОНТЕКСТ ТЕКУЩЕГО ОБСУЖДЕНИЯ')[1]?.split('Задача на этот комментарий:')[0].trim() ?? '';
if (!db.prepare('SELECT id FROM personas LIMIT 1').get()) {
  saveProfile('helga', helga);
}

async function readInput(request: IncomingMessage): Promise<Input> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Ожидается JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Запрос слишком большой.');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Ожидается объект JSON.');
  return input;
}

function draftRequest(input: Input) {
  if (input.mode !== 'topic' && input.mode !== 'reply') throw new Error('Выберите режим.');
  return {
    mode: input.mode,
    task: field(input, 'task', 12000, true),
    context: field(input, 'context', 50000),
    target: input.mode === 'reply' ? field(input, 'target') : '',
    refinement: field(input, 'refinement'),
  };
}

function parseDraft(content: string, topic: boolean) {
  try {
    const data = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gi, '')) as Input;
    return { title: topic ? field(data, 'title', 500, true) : '', text: field(data, 'text', 24000, true) };
  } catch {
    throw new Error('Модель вернула черновик в неверном формате. Повторите генерацию.');
  }
}

const web = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const port = server.address();
  const host = `127.0.0.1:${typeof port === 'object' && port ? port.port : ''}`;
  if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== `http://${host}`)) {
    response.writeHead(403).end();
    return;
  }

  const send = (result: unknown, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
  try {
    const route = request.url ?? '/';
    if (request.method === 'GET') {
      const asset = web.get(route);
      if (asset) {
        const source = readFileSync(new URL('../public/' + asset[0], import.meta.url), 'utf8');
        response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        response.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' }).end(source);
        return;
      }
      if (route === '/api/state') {
        const personas = db.prepare('SELECT id FROM personas WHERE id NOT IN (SELECT id FROM deleted_personas) ORDER BY rowid').all().map(row => profile(String(row.id)));
        const drafts = db.prepare('SELECT id, persona, version, data, updated FROM drafts ORDER BY updated DESC').all()
          .map(row => ({ id: row.id, persona: row.persona, version: row.version, updated: row.updated, ...JSON.parse(String(row.data)) }));
        const defaultProvider = db.prepare("SELECT value FROM settings WHERE key = 'default_provider'").get()?.value ?? '';
        send({ personas, drafts, fields, providers: models(), exampleContext, defaultProvider });
        return;
      }
    }

    if (request.method === 'POST' && ['/api/persona', '/api/persona/delete', '/api/probe', '/api/settings/default-provider', '/api/generate', '/api/draft'].includes(route)) {
      const input = await readInput(request);
      if (route === '/api/persona') {
        const id = field(input, 'id', 50) || crypto.randomUUID();
        const data = Object.fromEntries(Object.keys(fields).map(key => [key, field(input, key, key === 'name' ? 100 : 12000, key === 'name')]));
        send(saveProfile(id, data));
      }
      if (route === '/api/persona/delete') {
        const id = field(input, 'id', 50, true);
        db.prepare(`INSERT OR IGNORE INTO deleted_personas (id)
          SELECT id FROM personas WHERE id = ?`).run(id);
        send({ ok: true });
      }
      if (route === '/api/settings/default-provider') {
        const id = field(input, 'provider', 30);
        if (id && !models().some(item => item.id === id && item.ready)) {
          throw new Error('Выберите настроенную модель.');
        }
        db.prepare(`INSERT INTO settings (key, value) VALUES ('default_provider', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(id);
        send({ defaultProvider: id });
      }
      if (route === '/api/probe') {
        await complete(field(input, 'provider'), 'Ответь одним словом.', 'Проверка подключения.');
        send({ ok: true });
      }
      if (route === '/api/generate') {
        const persona = profile(field(input, 'persona'));
        const values = draftRequest(input);
        const profileText = Object.entries(fields)
          .filter(([key]) => key !== 'topicLength' && key !== 'replyLength' && persona[key])
          .map(([key, label]) => `${label}: ${persona[key]}`).join('\n');
        const system = buildDraftPrompt({
          profile: profileText,
          mode: values.mode,
          length: persona[values.mode === 'topic' ? 'topicLength' : 'replyLength'] ?? '',
        });
        const user = JSON.stringify(values);
        if (input.debug === true) {
          send({ system, user });
          return;
        }
        const result = await complete(field(input, 'provider'), system, user, values.mode);
        send({
          id: crypto.randomUUID(), persona: persona.id, personaName: persona.name, version: persona.version,
          provider: result.provider, model: result.model, ...values,
          original: parseDraft(result.content, values.mode === 'topic'),
        });
      }
      if (route === '/api/draft') {
        const id = field(input, 'id', 50, true);
        const existing = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
        const previous = existing ? JSON.parse(String(existing.data)) : null;
        const values = draftRequest(input);
        const persona = existing ? String(existing.persona) : field(input, 'persona', 50, true);
        const version = existing?.version ?? Number(input.version);
        const snapshot = db.prepare('SELECT data FROM profiles WHERE persona = ? AND version = ?').get(persona, version);
        if (!snapshot) throw new Error('Версия персонажа не найдена.');
        const edited = parseDraft(JSON.stringify(input.edited), values.mode === 'topic');
        const original = previous?.original ?? parseDraft(JSON.stringify(input.original), values.mode === 'topic');
        const data = {
          ...values,
          context: input.keep === true ? values.context : '',
          target: input.keep === true ? values.target : '',
          personaName: previous?.personaName ?? (field(input, 'personaName', 100) || JSON.parse(String(snapshot.data)).name),
          provider: previous?.provider ?? field(input, 'provider', 30, true),
          model: previous?.model ?? field(input, 'model', 250, true),
          original, edited,
        };
        db.prepare(`INSERT INTO drafts VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated`)
          .run(id, persona, version, JSON.stringify(data), new Date().toISOString());
        send({ id });
      }
      return;
    }
    send({ error: 'Страница не найдена.' }, 404);
  } catch (error) {
    if (!response.headersSent) send({ error: error instanceof Error ? error.message : 'Не удалось выполнить запрос.' }, 400);
  }
});

server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') console.log(`UGC Persona: http://127.0.0.1:${address.port}`);
});
