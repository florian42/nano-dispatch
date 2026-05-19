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

export interface ScriptingPort {
  getCurrentSelection(tabId: number): Promise<string>;
}

export interface SidePanelPorts {
  tabs: TabsPort;
  config: ConfigPort;
  runtime: RuntimePort;
  scripting: ScriptingPort;
}
