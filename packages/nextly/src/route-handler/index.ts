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
} from "./auth-handler";
