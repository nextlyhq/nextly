/**
 * Barrel export for all domain DI registration functions.
 *
 * The orchestrator in `register.ts` imports from this module and calls
 * each function after the shared registration context is assembled.
 */

export { registerAuthServices } from "./register-auth";
export { registerCollectionServices } from "./register-collections";
export { registerComponentServices } from "./register-components";
export { registerDashboardServices } from "./register-dashboard";
export { registerEmailServices } from "./register-email";
export { registerMediaServices } from "./register-media";
export { registerMetaServices } from "./register-meta";
export { registerSingleServices } from "./register-singles";
export { registerUserServices } from "./register-users";
export type { RegistrationContext } from "./types";
