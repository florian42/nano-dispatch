// Re-export Buffer from the `buffer` npm package so esbuild's `inject` can
// stamp it into every module that references `Buffer` as a global.
import { Buffer } from 'buffer';
export { Buffer };
