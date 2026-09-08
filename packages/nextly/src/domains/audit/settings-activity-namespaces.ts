/**
 * The `activity_log.collection` values that name a SETTINGS resource.
 *
 * `activity_log.collection` is a free string, deliberately — see
 * {@link recordSettingsActivity}, whose docblock explains that a settings
 * resource gets a name of the same shape as a content collection rather than a
 * second trail with its own reader. The consequence is that the column's
 * namespace is WIDER than the union of the collection and single registries,
 * and anything enumerating candidates from those two registries alone is
 * enumerating a subset of what the column actually holds.
 *
 * That subset is not a safe default. A reader that filters
 * `collection IN (...)` over it drops every settings entry for every caller,
 * super-admin included — and these are the entries worth keeping most. Rotating
 * SMTP credentials records `collection = "email-providers"` with
 * `changedFields: ["host", "username", "password"]` against the rows that send
 * password-reset mail. Losing that is losing a credential-change audit trail.
 *
 * So the namespaces are named here, once, composed from the constants their own
 * writers already export rather than restated as literals — a second spelling
 * of `"email-providers"` is exactly how a reader and a writer drift apart
 * silently.
 *
 * This is a list of CANDIDATES, never of grants. Every consumer still asks
 * `canReadEntity` per name, and each has a real answer: `read-email-providers`
 * and `read-email-templates` are seeded permissions (`permission-seed-service`)
 * that `routeHandler` already authorizes the corresponding settings routes
 * with. Appending a name here widens what may be CONSIDERED, never what is
 * allowed.
 *
 * A new `recordSettingsActivity` caller belongs in this list. It is deliberately
 * in the audit domain, beside the writer that creates the namespace, so that a
 * new writer and the readers of its rows are one file apart.
 *
 * @module domains/audit/settings-activity-namespaces
 */

import { EMAIL_PROVIDER_ACTIVITY_COLLECTION } from "../email/provider-activity";
import { EMAIL_TEMPLATE_ACTIVITY_COLLECTION } from "../email/template-activity";

/**
 * Every non-content `activity_log.collection` a production writer emits.
 *
 * `as const` so a consumer can narrow against the union rather than against
 * `string`, and so an accidental mutation is a type error rather than a
 * scope that grows at runtime.
 */
export const SETTINGS_ACTIVITY_NAMESPACES = [
  EMAIL_PROVIDER_ACTIVITY_COLLECTION,
  EMAIL_TEMPLATE_ACTIVITY_COLLECTION,
] as const;
