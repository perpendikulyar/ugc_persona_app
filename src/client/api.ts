export type TextDraft = { title: string; text: string };
export type Profile = Record<string, string | number> & { id: string; name: string; version: number };
export type Provider = { id: string; name: string; model?: string; ready: boolean };
export type Draft = {
  id: string; persona: string; personaName: string; version: number; provider: string; model: string;
  mode: 'topic' | 'reply'; task: string; context: string; target: string; refinement: string;
  original: TextDraft; edited?: TextDraft; updated?: string;
};
export type Workspace = {
  defaultProvider: string;
  proxyEnabled: boolean;
  proxyAddress: string;
  personas: Profile[]; drafts: Draft[]; providers: Provider[]; fields: Record<string, string>; exampleContext: string;
};
export type GenerationRequest = Pick<Draft, 'persona' | 'mode' | 'task' | 'context' | 'target' | 'refinement' | 'provider'>;

export async function api<T>(path: string, data?: object): Promise<T> {
  const response = await fetch('/api/' + path, data ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
