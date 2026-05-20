// Minimal `util` polyfill for the browser/SW bundle. GramJS's TL class
// builder uses `util.inspect.custom` as a symbol key for a debug method;
// it's never invoked in our code paths, but the class definition needs
// the symbol to exist. Other surface (`util.promisify`, `util.format`)
// would have to be added on demand.
const inspect = {
  custom: Symbol.for('nodejs.util.inspect.custom'),
};
export { inspect };
export default { inspect };
