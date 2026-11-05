/**
 * The composition actions an API client makes on a stored page and on a
 * component's definition, named where any client and the server can read
 * them. Free of runtime imports, for the reason `library-contract` is.
 *
 * Every action works the same way:
 *
 * - **`dryRun: true`** answers what the action would write, and whether the
 *   site would accept it, without writing. The write is made as the caller
 *   and rolled back, so the site's own checks answer: field validation over
 *   the composed page, locks, the loop guard, the caller's rights.
 * - **`fingerprint`** in every answer names the stored document the action
 *   was planned against. Sent back as **`expect`**, it makes the action apply
 *   only to that document: one that changed since answers 409, and the
 *   caller plans again.
 * - **`by`** says who the action ran as: the signed-in person, or the API key
 *   and its owner. The write is made as the caller, so the item's content
 *   events record it under the caller's account.
 *
 * @experimental Settles when the composition API ships.
 * @module composition-actions-contract
 */
import type {
  BlockDocument,
  BuilderOp,
  ComponentDocument,
  OpPosition,
  ValidationIssue,
} from "@nextlyhq/blocks-engine";

import type { ActionBy } from "./component-actions-contract";
import type { StoredPageAddress } from "./library-contract";

/**
 * `POST /pages/actions`: one action on a stored page's blocks field or its
 * Layout.
 *
 * @experimental Settles when the composition API ships.
 */
export const PAGE_ACTIONS_ROUTE_PATH = "/pages/actions";

/** Where on the page an inserted block goes; the end of the page when absent. */
export type ActionPosition = OpPosition;

/** One action on a stored page. */
export type PageAction =
  /** Insert a published pattern's blocks, copied, as the editor's insert panel does. */
  | {
      readonly kind: "insert-pattern";
      readonly patternId: string;
      readonly at?: ActionPosition;
    }
  /** Place a component by reference, optionally choosing a variant and values. */
  | {
      readonly kind: "place-component";
      readonly componentId: string;
      readonly variant?: string;
      readonly values?: Readonly<Record<string, unknown>>;
      readonly at?: ActionPosition;
    }
  /**
   * Set a placement's exposed values, keyed by exposure id. `{ "$unset": true }`
   * empties a field ("Cleared"); `reset` returns fields to what the variant or
   * the definition gives them.
   */
  | {
      readonly kind: "set-placement-values";
      readonly instanceId: string;
      readonly values?: Readonly<Record<string, unknown>>;
      readonly reset?: readonly string[];
    }
  /** Choose a placement's variant by its stable id, or `null` for the defaults. */
  | {
      readonly kind: "choose-variant";
      readonly instanceId: string;
      readonly variant: string | null;
    }
  /**
   * Choose the page's Layout: a Layout's id, or `null` for the site's default.
   * `noHeaderFooter: true` switches the Layout off for this page; absent, it
   * is turned back on, as choosing a Layout in the editor does.
   */
  | {
      readonly kind: "set-layout";
      readonly layout: string | null;
      readonly noHeaderFooter?: boolean;
    };

/** @experimental Settles when the composition API ships. */
export interface PageActionRequest {
  readonly page: StoredPageAddress;
  readonly action: PageAction;
  readonly dryRun?: boolean;
  /** The `fingerprint` of the answer this action was confirmed from. */
  readonly expect?: string;
  /** Publish the page with the change, rather than saving its working draft. */
  readonly publish?: boolean;
}

/** @experimental Settles when the composition API ships. */
export interface PageActionResult {
  readonly dryRun: boolean;
  readonly page: { readonly collection: string; readonly id: string };
  /** The edits to the blocks field, as the editor would apply them; none for `set-layout`. */
  readonly ops: readonly BuilderOp[];
  /** The page's blocks field as the action leaves it. */
  readonly document?: BlockDocument;
  /** For `set-layout`: the page's Layout fields as the action leaves them. */
  readonly layout?: {
    readonly layout: string | null;
    readonly noHeaderFooter: boolean;
  };
  /** The id of a block the action added, for the next action to address. */
  readonly insertedId?: string;
  /** Why the site would refuse the write, in its own words; empty when it accepts it. */
  readonly refusals: readonly string[];
  /** The stored state this answer was planned against, for `expect`. */
  readonly fingerprint: string;
  readonly by: ActionBy;
}

/**
 * `POST /components/:id/definition`: one edit to a component's definition.
 *
 * @experimental Settles when the composition API ships.
 */
export function definitionActionPath(componentId: string): string {
  return `/components/${encodeURIComponent(componentId)}/definition`;
}

/** The route path the definition actions are declared under. */
export const DEFINITION_ACTIONS_ROUTE_PATH = "/components/:id/definition";

/** Which part of a block an exposure targets: a prop, or its visibility. */
export type ExposureTargetInput =
  | { readonly nodeId: string; readonly propPath: string }
  | { readonly nodeId: string; readonly visibility: true };

/** One edit to a component's definition, each the editor's own planner. */
export type DefinitionAction =
  | ({ readonly kind: "expose"; readonly label: string } & ExposureTargetInput)
  | {
      readonly kind: "rename-exposure";
      readonly exposureId: string;
      readonly label: string;
    }
  | ({
      readonly kind: "retarget-exposure";
      readonly exposureId: string;
    } & ExposureTargetInput)
  | { readonly kind: "remove-exposure"; readonly exposureId: string }
  | { readonly kind: "remove-exposed-slot"; readonly slotId: string }
  | { readonly kind: "add-variant"; readonly label: string }
  | {
      readonly kind: "rename-variant";
      readonly variantId: string;
      readonly label: string;
    }
  | { readonly kind: "delete-variant"; readonly variantId: string }
  | {
      readonly kind: "set-variant-value";
      readonly variantId: string;
      readonly exposureId: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "reset-variant-value";
      readonly variantId: string;
      readonly exposureId: string;
    };

/** @experimental Settles when the composition API ships. */
export interface DefinitionActionRequest {
  readonly action: DefinitionAction;
  readonly dryRun?: boolean;
  readonly expect?: string;
  /** Publish the component with the change, rather than saving its working draft. */
  readonly publish?: boolean;
}

/** @experimental Settles when the composition API ships. */
export interface DefinitionActionResult {
  readonly dryRun: boolean;
  readonly component: { readonly id: string };
  /** The definition as the edit leaves it. */
  readonly definition: ComponentDocument;
  /** The exposure, slot or variant the edit made or changed. */
  readonly targetId: string;
  /** Variants a field's removal emptied or changed. */
  readonly prunedVariants?: readonly {
    readonly variant: string;
    readonly label: string;
    readonly emptied: boolean;
  }[];
  readonly warnings: readonly ValidationIssue[];
  readonly refusals: readonly string[];
  readonly fingerprint: string;
  readonly by: ActionBy;
}
