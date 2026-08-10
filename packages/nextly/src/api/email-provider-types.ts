/**
 * Which email providers this installation can configure.
 *
 * The admin cannot know what a plugin registered — it is compiled long before
 * any install chooses its plugins — so the set of provider types, and the
 * fields each one needs, has to come from the server that holds the registry.
 * Without this the definitions exist and nothing can reach them, which is the
 * state the provider contract was written to end.
 *
 * @example
 * ```typescript
 * // In your Next.js app: app/api/email-providers/types/route.ts
 * export { GET } from 'nextly/api/email-provider-types';
 * ```
 *
 * @module api/email-provider-types
 */

import { toDescriptor } from "../domains/email/provider-definition";
import { getEmailProviderRegistry } from "../domains/email/services/email-provider-registry";
import { getCachedNextly } from "../init";

import { respondData } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * List the registered provider types and the fields each one takes.
 *
 * Returns descriptors, never definitions: `parseConfig` and `createAdapter` are
 * server functions and no stored value is involved, so nothing here can leak a
 * credential. What it does reveal is which plugins an install runs, so it sits
 * behind the same permission as reading the providers themselves rather than
 * being public.
 */
export const GET = withErrorHandler(async (request: Request) => {
  // Boot BEFORE authorising, not after. API-key auth answers 503 when
  // `apiKeyService` is not registered yet, so on the first request to a cold
  // serverless instance a valid key would be rejected before this handler ever
  // reached its own bootstrap. Booting first also means the registry is seeded,
  // which a read beforehand would miss -- reporting only the built-ins on a
  // cold instance and the full set on a warm one.
  await getCachedNextly();

  // `create` is included deliberately: the permissions are seeded
  // independently, so a role granted only create could authorize a POST and
  // still be unable to discover the fields a plugin provider requires --
  // leaving the grant unusable for exactly the providers this catalog exists
  // to describe. It exposes definitions, never stored provider records.
  await requireRouteAnyPermission(request, [
    { action: "read", resource: "email-providers" },
    { action: "create", resource: "email-providers" },
    { action: "manage", resource: "email-providers" },
  ]);

  const types = getEmailProviderRegistry().list().map(toDescriptor);

  // Non-paginated list; wrap in a named field for the canonical respondData
  // shape (spec §5.1 rule 3), matching the providers list endpoint. The
  // registry is a fixed in-memory set, so `{ items, meta }` would mean
  // manufacturing pagination that describes nothing.
  return respondData({ types });
});
