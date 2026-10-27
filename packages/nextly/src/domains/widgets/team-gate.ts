/**
 * Who the Team card is for: a reader who may read people AND may add or change
 * them.
 *
 * One constant, read by the card's declaration and by the `system:team`
 * source's resolver, so the card is offered to exactly the readers its source
 * answers. Kept in the widget domain, beside the core declarations that name
 * it, because those declarations may not import from the services the
 * resolver lives in.
 *
 * @module domains/widgets/team-gate
 */

import type { WidgetPermissionGate } from "./gate";

/** The Team card's gate, in the `allOf` form: every entry, each satisfied by any of its slugs. */
export const TEAM_GATE = {
  allOf: ["read-users", ["create-users", "update-users"]],
} as const satisfies WidgetPermissionGate;

/** What a Team reader must also hold to be shown the number of roles beside the number of people. */
export const TEAM_ROLES_PERMISSION = "read-roles";
