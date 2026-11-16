/**
 * Who may count the people on a site, and how a Count card says it counts them.
 *
 * One module, read by the Count declaration, by the `system:users` source's
 * resolver, and by the rules that withhold a card and refuse a save, so the
 * card is offered Users for exactly the readers its source answers. Kept in
 * the widget domain, beside `team-gate`, because the core declarations naming
 * it may not import from the services the resolver reaches.
 *
 * @module domains/widgets/users-gate
 */

import type { CountUsersSource } from "./core-widgets/data";

/** What a reader must hold to be offered Users, and to be answered by `system:users`. */
export const USERS_READ_PERMISSION = "read-users";

/**
 * The value a Collection setting that offers Users stores for it. A slug no
 * collection can take (`users` is reserved), so it never names a collection a
 * reader could also be offered.
 */
export const COUNT_USERS_SOURCE: CountUsersSource = "users";
