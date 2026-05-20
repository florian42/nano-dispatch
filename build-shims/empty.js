// Empty shim. GramJS conditionally imports Node built-ins (fs, net, tls,
// stream, ...) behind environment checks that never fire in the browser /
// service worker bundle. Aliasing them to this file lets esbuild resolve the
// imports without pulling in real Node modules.
export default {};
