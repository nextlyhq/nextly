/**
 * What the template actions route takes and answers, with no runtime imports,
 * so a client, the service and the route share one description of it.
 *
 * A request is one action and, optionally, `dryRun`. A dry run makes the
 * action's write as the caller, inside a transaction it rolls back, and
 * answers what the site would say: `refusals` holds the site's own words when
 * it would refuse, and is empty when it would accept. An apply that the site
 * refuses writes nothing and answers the refusal as an error.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/template-actions-contract
 */
import type { TemplateAction } from "@nextlyhq/builder/ops";
import type { PaginationMeta } from "@nextlyhq/plugin-sdk";

import type { ActionBy } from "../component-actions-contract";

export type { TemplateAction };

/** Where the template actions are served, under the plugin's route prefix. */
export const TEMPLATE_ACTIONS_ROUTE_PATH = "/templates/actions";

/** Where the admin asks whether this caller may change template addresses. */
export const TEMPLATE_ROUTING_ROUTE_PATH = "/templates/routing";

/** What the routing route answers. */
export interface TemplateRoutingAccess {
  /** Whether the caller holds `manage-template-routing`. */
  readonly mayManageRouting: boolean;
}

/**
 * Where the template form asks whether a saved template may be pointed at
 * another collection: `GET /templates/collection-retarget?template=<id>`.
 */
export const TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH =
  "/templates/collection-retarget";

/**
 * What the template guard's rule says of pointing a saved template at
 * another collection: allowed; refused while the collection it draws still
 * exists; or refused until the address it stores is removed.
 */
export type TemplateRetargetVerdict =
  | "allowed"
  | "collection-exists"
  | "address-blocks";

/** What the retarget question answers, from the template as stored. */
export type TemplateCollectionRetarget =
  | { readonly retarget: "allowed" | "collection-exists" }
  | {
      readonly retarget: "address-blocks";
      /**
       * Whether the caller may clear that address, which needs
       * `manage-template-routing`, as the address field's own rule says.
       */
      readonly mayClearAddress: boolean;
    };

/** The retarget question's path for one template, by its id. */
export function templateCollectionRetargetPath(template: string): string {
  return `${TEMPLATE_COLLECTION_RETARGET_ROUTE_PATH}?template=${encodeURIComponent(template)}`;
}

/**
 * Where the template form lists the collections a template may draw:
 * `GET /templates/collection-choices`.
 */
export const TEMPLATE_COLLECTION_CHOICES_ROUTE_PATH =
  "/templates/collection-choices";

/** One collection a template may draw, by slug and by name. */
export interface TemplateCollectionChoice {
  readonly slug: string;
  /** Its plural name where it has one, else its name, else its slug. */
  readonly label: string;
}

/**
 * What the choices route answers: the canonical list envelope, every
 * collection on one page, ordered by name and then slug.
 */
export interface TemplateCollectionChoicesResponse {
  readonly items: readonly TemplateCollectionChoice[];
  readonly meta: PaginationMeta;
}

/** One template action request. */
export interface TemplateActionRequest {
  readonly action: TemplateAction;
  readonly dryRun?: boolean;
}

/** A template as an answer shows it. */
export interface TemplateSummary {
  /** Absent from a dry run's create, which stores nothing. */
  readonly id?: string;
  readonly title: string;
  /** The collection whose entries it draws, or whose entry it serves. */
  readonly collection: string;
  /** For an entry's own design, the id of the entry it serves. */
  readonly entry?: string;
  readonly status: "draft" | "published";
  /**
   * The address its collection's entries are served at, as the template
   * stores it, or null for none. Absent where the action does not set one.
   */
  readonly address?: string | null;
}

/** What a template action answers. */
export interface TemplateActionResult {
  readonly dryRun: boolean;
  readonly kind: TemplateAction["kind"];
  /** The template as the write stored it, or would have. */
  readonly template?: TemplateSummary;
  /** Why the site would refuse the action, in its own words; empty when it would not. */
  readonly refusals: readonly string[];
  /**
   * For an applied `set-template-address`: how many of the collection's
   * entries wait for an address another document holds, unserved until it
   * is given up. The address store's waiting report names each.
   */
  readonly waiting?: number;
  readonly by: ActionBy;
}
