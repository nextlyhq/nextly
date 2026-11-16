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
  ValidationIssue,
} from "@nextlyhq/blocks-engine";
import type {
  DefinitionAction,
  PageAction,
  UnbindAnswer,
} from "@nextlyhq/builder/ops";

import type { ActionBy } from "./component-actions-contract";
import type { StoredPageAddress } from "./library-contract";

/**
 * `POST /pages/actions`: one action on a stored page's blocks field or its
 * Layout.
 *
 * @experimental Settles when the composition API ships.
 */
export const PAGE_ACTIONS_ROUTE_PATH = "/pages/actions";

// The actions themselves are the builder's, published with the schemas the
// routes parse them with, so a client typing against this contract and one
// validating against `@nextlyhq/builder/ops` hold the same shape.
export type {
  ActionPosition,
  DefinitionAction,
  ExposureTargetInput,
  ListQueryChange,
  PageAction,
  UnbindAnswer,
  UnbindKeep,
} from "@nextlyhq/builder/ops";

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
  /** For `unbind-prop`: what was kept in the prop's place, and why. */
  readonly unbound?: UnbindAnswer;
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
