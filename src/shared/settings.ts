export type Config = {
  botToken: string;
  chatId: string;
};

export async function getConfig(): Promise<Partial<Config>> {
  const data = (await chrome.storage.local.get(['botToken', 'chatId'])) as Partial<Config>;
  return data;
}

export async function setConfig(config: Config): Promise<void> {
  await chrome.storage.local.set(config);
}

export function configValid(c: Partial<Config>): c is Config {
  return (
    typeof c.botToken === 'string' &&
    c.botToken.length > 0 &&
    typeof c.chatId === 'string' &&
    c.chatId.length > 0
  );
}
