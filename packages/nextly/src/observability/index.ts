// Public exports for nextly/observability entry point.

export { type NextlyLogger, setNextlyLogger, getNextlyLogger } from "./logger";
export {
  type OnErrorHook,
  setGlobalOnError,
  getGlobalOnError,
} from "./on-error";
export { createNextlyInstrumentation } from "./instrumentation";
