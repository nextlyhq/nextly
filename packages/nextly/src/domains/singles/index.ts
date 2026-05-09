/**
 * Singles Domain
 *
 * Public entrypoint for the Singles domain. Re-exports services, types,
 * and utilities so consumers can import from the domain barrel rather
 * than reaching into internal service files directly.
 *
 * @module domains/singles
 * @since 1.0.0
 */

export { SingleEntryService } from "./services/single-entry-service";

export {
  SingleQueryService,
  getSingleHookCollection,
  resolveNextlyForHooks,
  buildSingleHookContext,
  checkSingleAccess,
  SINGLE_HOOK_NAMESPACE,
} from "./services/single-query-service";

export { SingleMutationService } from "./services/single-mutation-service";

export {
  SingleRegistryService,
  type UpdateSingleOptions as UpdateSingleRegistryOptions,
  type DeleteSingleOptions,
  type CodeFirstSingleConfig,
  type SyncSingleResult,
  type ListSinglesOptions,
  type ListSinglesResult,
} from "./services/single-registry-service";

export type {
  GetSingleOptions,
  UpdateSingleOptions,
  UserContext,
  SingleResult,
  SingleDocument,
} from "./types";
