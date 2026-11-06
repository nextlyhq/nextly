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

import type { ActionBy } from "../component-actions-contract";

export type { TemplateAction };

/** Where the template actions are served, under the plugin's route prefix. */
export const TEMPLATE_ACTIONS_ROUTE_PATH = "/templates/actions";

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
  /** The collection whose entries it draws. */
  readonly collection: string;
  readonly status: "draft" | "published";
}

/** What a template action answers. */
export interface TemplateActionResult {
  readonly dryRun: boolean;
  readonly kind: TemplateAction["kind"];
  /** The template as the write stored it, or would have. */
  readonly template?: TemplateSummary;
  /** Why the site would refuse the action, in its own words; empty when it would not. */
  readonly refusals: readonly string[];
  readonly by: ActionBy;
}
