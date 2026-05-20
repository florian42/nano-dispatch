export type Config = {
  apiId: number;
  apiHash: string;
  session: string;
  peer: string;
};

const KEYS = ['apiId', 'apiHash', 'session', 'peer'] as const;

export async function getConfig(): Promise<Partial<Config>> {
  const data = (await chrome.storage.local.get([...KEYS])) as Partial<Config>;
  return data;
}

export async function setConfig(config: Config): Promise<void> {
  await chrome.storage.local.set(config);
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove('session');
}

export function configValid(c: Partial<Config>): c is Config {
  return (
    typeof c.apiId === 'number' &&
    Number.isFinite(c.apiId) &&
    c.apiId > 0 &&
    typeof c.apiHash === 'string' &&
    c.apiHash.length > 0 &&
    typeof c.session === 'string' &&
    c.session.length > 0 &&
    typeof c.peer === 'string' &&
    c.peer.length > 0
  );
}
