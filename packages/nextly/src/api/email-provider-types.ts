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
  await requireRouteAnyPermission(request, [
    { action: "read", resource: "email-providers" },
    { action: "manage", resource: "email-providers" },
  ]);

  // Boot first: the registry is seeded during initialization, and reading it
  // beforehand would report only the built-ins on a cold serverless instance
  // and the full set on a warm one.
  await getCachedNextly();

  const types = getEmailProviderRegistry().list().map(toDescriptor);
  return respondData({ types });
});
