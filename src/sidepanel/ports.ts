import type { Config } from '../shared/settings.js';
import type { DispatchResult } from '../dispatcher/types.js';

export interface ActiveTab {
  id: number;
  title: string;
  url: string;
}

export interface TabsPort {
  getActive(): Promise<ActiveTab | null>;
  onActivated(cb: () => void): void;
  onUpdated(cb: (tabId: number, change: { title?: string; url?: string }) => void): void;
}

export interface ConfigPort {
  get(): Promise<Partial<Config>>;
}

export interface RuntimePort {
  send(message: { type: 'send'; tabId: number; note: string }): Promise<DispatchResult | undefined>;
  openOptionsPage(): void;
}

// Result of probing a tab for read access. `ok` carries the current
// selection. `needs_activation` means the tab is an ordinary http(s)
// page but activeTab hasn't been granted for it yet — the user must
// click the toolbar icon while on that tab. `restricted` means Chrome
// never allows extensions to script this URL scheme (chrome://,
// file://, Web Store, devtools, etc.).
export type TabAccess =
  | { kind: 'ok'; selection: string }
  | { kind: 'needs_activation' }
  | { kind: 'restricted' };

export interface ScriptingPort {
  probe(tabId: number, url: string): Promise<TabAccess>;
}

export interface SidePanelPorts {
  tabs: TabsPort;
  config: ConfigPort;
  runtime: RuntimePort;
  scripting: ScriptingPort;
}
