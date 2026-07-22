/**
 * Route Handler Module
 *
 * Barrel export for route handling utilities.
 */

// Route parsing
export {
  parseRestRoute,
  getActionFromMethod,
  getActionFromOperation,
  isPublicEndpoint,
  requiresAuthOnly,
  type ParsedRoute,
} from "./route-parser";

// Auth handling
export {
  handleAuthRequest,
  getDispatcher,
  setHandlerConfig,
  getHandlerConfig,
  // Consumed by the direct-dispatch entry points, which return before the
  // dispatcher path that normally performs initialisation.
  ensureServicesInitialized,
} from "./auth-handler";
