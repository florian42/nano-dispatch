// Minimal `os` polyfill for the browser/SW bundle. GramJS calls
// `os.type()` and `os.release()` to populate device metadata in its
// InitConnection wrapper. The values are advisory (shown in Telegram's
// "Active Sessions" UI as the device that signed in); we return browser-
// shaped strings rather than masquerading as a Node host.
const type = () => 'Browser';
const release = () => navigator?.userAgent ?? '1.0';
const arch = () => 'web';
const platform = () => 'browser';
export { type, release, arch, platform };
export default { type, release, arch, platform };
