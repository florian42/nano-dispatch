// Headless load of dist/background/service-worker.js with chrome.* stubs and
// SW-like globals. Catches top-level evaluation errors that would prevent
// chrome.action.onClicked.addListener from being registered.

const chromeStub = {
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
    open: () => Promise.resolve(),
  },
  action: {
    onClicked: { addListener: (fn) => console.log('registered: action.onClicked', typeof fn) },
  },
  runtime: {
    id: 'fake-extension-id',
    onMessage: { addListener: (fn) => console.log('registered: runtime.onMessage', typeof fn) },
    sendMessage: () => Promise.resolve(),
  },
  tabs: {
    get: () => Promise.resolve({}),
  },
  scripting: {
    executeScript: () => Promise.resolve([]),
  },
  storage: {
    local: {
      get: () => Promise.resolve({}),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  },
};

globalThis.chrome = chromeStub;
globalThis.self = globalThis;
// Match a real MV3 SW context: self.location is the SW script URL, on
// chrome-extension://<id>/path.
globalThis.location = {
  protocol: 'chrome-extension:',
  href: 'chrome-extension://fake-extension-id/background/service-worker.js',
  host: 'fake-extension-id',
};
delete globalThis.window;

try {
  await import('../dist/background/service-worker.js');
  console.log('SW bundle loaded without throwing.');
} catch (err) {
  console.error('SW bundle threw at init:', err);
  process.exit(1);
}
