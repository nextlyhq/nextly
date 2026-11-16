/**
 * What the detach, duplicate and update-pattern routes take and answer, named
 * where the editor and the server can both read it. Free of runtime imports,
 * for the reason `library-contract` is.
 *
 * @module component-actions-contract
 */
import type {
  BlockDocument,
  BuilderOp,
  ComponentDocument,
} from "@nextlyhq/blocks-engine";

import type { StoredPageAddress } from "./library-contract";

/**
 * Who ran an action: the signed-in user, or the API key and its owner.
 *
 * @experimental Settles when the composition API ships.
 */
export interface ActionBy {
  readonly kind: "user" | "api-key";
  readonly userId: string;
  readonly apiKeyId?: string;
}

/**
 * Where a placement is: in a page the caller holds (`library`, the editor's)
 * or in a stored page the server edits (`stored`, the API's).
 *
 * @experimental Settles when the composition API ships.
 */
export type PlacementAt =
  | {
      readonly apply?: "library";
      readonly document: BlockDocument;
      readonly instanceId: string;
      /** The language the editor shows components in, when translated. */
      readonly locale?: string;
    }
  | {
      readonly apply: "stored";
      readonly page: StoredPageAddress;
      readonly instanceId: string;
    };

/**
 * `POST /components/detach`: replace a placement with the plain blocks it
 * draws.
 *
 * @experimental Settles when the composition API ships.
 */
export const DETACH_ROUTE_PATH = "/components/detach";

/** @experimental Settles when the composition API ships. */
export type DetachRequest = PlacementAt & { readonly dryRun?: boolean };

/** @experimental Settles when the composition API ships. */
export interface DetachResult {
  readonly dryRun: boolean;
  /** The ops that replace the placement; already applied in `stored` mode. */
  readonly pageOps: readonly BuilderOp[];
  /** The component the placement drew, by id and title. */
  readonly component: { readonly id: string; readonly title: string };
  /**
   * Whether the component has changes not yet published. The detach keeps
   * what the author sees, which is the newer version, so a page published
   * afterwards shows content the live component does not.
   */
  readonly unpublishedChanges: boolean;
  readonly by: ActionBy;
}

/**
 * `POST /components/:id/duplicate`: copy a component, and, from a placement,
 * point that one placement at the copy.
 *
 * @experimental Settles when the composition API ships.
 */
export const DUPLICATE_ROUTE_PATH = "/components/:id/duplicate";

/** The duplicate route's path for one component. */
export function duplicatePath(id: string): string {
  return DUPLICATE_ROUTE_PATH.replace(":id", encodeURIComponent(id));
}

/** @experimental Settles when the composition API ships. */
export interface DuplicateRequest {
  readonly dryRun?: boolean;
  /** The copy's name; "<source> copy" when not given. */
  readonly title?: string;
  /** The placement to point at the copy, when duplicating from one. */
  readonly placement?: PlacementAt;
}

/** @experimental Settles when the composition API ships. */
export interface DuplicateResult {
  readonly dryRun: boolean;
  /** The copy; on a dry run its id is the placeholder `(new-component)`. */
  readonly component: { readonly id: string; readonly title: string };
  readonly source: { readonly id: string };
  readonly definition: ComponentDocument;
  /** The op re-pointing the placement, when there was one. */
  readonly pageOps: readonly BuilderOp[];
  readonly by: ActionBy;
}

/**
 * `POST /patterns/:id/from-selection`: replace a pattern's content with a
 * selection. Pages that inserted it earlier keep their copies.
 *
 * @experimental Settles when the composition API ships.
 */
export const UPDATE_PATTERN_ROUTE_PATH = "/patterns/:id/from-selection";

/** The update-pattern route's path for one pattern. */
export function updatePatternPath(id: string): string {
  return UPDATE_PATTERN_ROUTE_PATH.replace(":id", encodeURIComponent(id));
}

/** @experimental Settles when the composition API ships. */
export interface UpdatePatternRequest {
  readonly dryRun?: boolean;
  readonly document: BlockDocument;
  readonly selectedIds: readonly string[];
}

/** @experimental Settles when the composition API ships. */
export interface UpdatePatternResult {
  readonly dryRun: boolean;
  readonly pattern: { readonly id: string };
  /** The pattern's new content. */
  readonly document: BlockDocument;
  /**
   * Ops that bring the saved-from blocks' record of the pattern up to date,
   * for the editor to apply; often none.
   */
  readonly pageOps: readonly BuilderOp[];
  readonly by: ActionBy;
}
