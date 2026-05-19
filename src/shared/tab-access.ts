// URL schemes Chrome never allows extensions to script, regardless of
// host_permissions or activeTab. Probing executeScript on these always
// throws — classify by URL up-front instead.
//
// Sources: chrome.scripting docs ("Restricted Sites") + chrome.tabs notes
// on internal pages. The Web Store is special-cased by Chrome itself.

const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'devtools:',
  'view-source:',
  'edge:',
  'about:',
  'file:',
];

const WEB_STORE_PREFIXES = [
  'https://chrome.google.com/webstore/',
  'https://chromewebstore.google.com/',
];

export function isRestrictedUrl(url: string): boolean {
  if (url === '') return true;
  for (const scheme of RESTRICTED_SCHEMES) {
    if (url.startsWith(scheme)) return true;
  }
  for (const prefix of WEB_STORE_PREFIXES) {
    if (url.startsWith(prefix)) return true;
  }
  return false;
}
