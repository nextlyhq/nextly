// Public exports for @revnixhq/nextly/observability entry point.

export { type NextlyLogger, setNextlyLogger, getNextlyLogger } from "./logger";
export {
  type OnErrorHook,
  setGlobalOnError,
  getGlobalOnError,
} from "./on-error";

// Note: createNextlyInstrumentation is added in Task 3 once withErrorHandler
// and withAction exist.
