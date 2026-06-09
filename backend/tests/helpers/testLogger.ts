import { Writable } from "node:stream"
import type { Logger } from "../../src/logger.js"

export function createTestLogger(): Logger {
  const noop = () => {}
  return {
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
    stream: new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
  }
}
