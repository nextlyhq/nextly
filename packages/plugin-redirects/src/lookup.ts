/**
 * Redirect resolution for `@nextlyhq/plugin-redirects`.
 *
 * Resolves a source path to its redirect target through the secure managed
 * service (D56 `where`, as system — redirects are public routing data). Pure
 * given a services object, so it is unit/integration-testable.
 */

/** The slice of `ctx.services` the lookup needs. */
export interface RedirectServices {
  collections: {
    listEntries(
      slug: string,
      query: {
        where?: Record<string, unknown>;
        pagination?: { limit?: number };
      },
      opts: { as: "system" }
    ): Promise<{ data: Array<Record<string, unknown>> }>;
  };
}

export interface RedirectMatch {
  /** Destination URL or path. */
  to: string;
  /** HTTP redirect status as a string ("301" | "302"). */
  type: string;
}

/** Find the redirect for a source path, or `null` if none. */
export async function findRedirect(
  services: RedirectServices,
  slug: string,
  from: string
): Promise<RedirectMatch | null> {
  const result = await services.collections.listEntries(
    slug,
    { where: { fromPath: { equals: from } }, pagination: { limit: 1 } },
    { as: "system" }
  );
  const row = result.data?.[0];
  if (!row || typeof row.toPath !== "string") return null;
  return {
    to: row.toPath,
    type: typeof row.type === "string" ? row.type : "301",
  };
}
