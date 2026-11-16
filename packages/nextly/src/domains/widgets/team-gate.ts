/**
 * Who the Team card is for: a reader who may read people, the permission the
 * Users page lists them by.
 *
 * One constant, read by the card's declaration and by the `system:team` and
 * `system:team-people` sources' resolvers, so the card is offered to exactly
 * the readers its sources answer. Kept in the widget domain, beside the core
 * declarations that name it, because those declarations may not import from
 * the services the resolvers live in.
 *
 * @module domains/widgets/team-gate
 */

import type { WidgetAccessGate } from "./declaration/define-widget";

/** The Team card's gate, in the declaration's `allOf` form, as the card's `access` states it. */
export const TEAM_GATE = {
  allOf: ["read-users"],
} as const satisfies WidgetAccessGate;

/** What a Team reader must also hold to be shown the number of roles beside the number of people. */
export const TEAM_ROLES_PERMISSION = "read-roles";
