/**
 * Paged reads of the site's registries: the Singles registry a page at a
 * time, and every collection's, Single's and field group's registry record,
 * for the schema fingerprint the bindings report checks against.
 */
import type { definePlugin } from "@nextlyhq/plugin-sdk";

/** What {@link singlesRegistryPages} yields for a registry it cannot read whole. */
export const UNREADABLE_PAGE: unique symbol = Symbol(
  "unreadable registry page"
);

/**
 * The Singles registry, a page at a time, ending after the last one; or
 * {@link UNREADABLE_PAGE}, and then nothing more, when a page is not shaped as
 * one or the population changed while it was listed.
 *
 * The count the first page reported is held because this walk pages by OFFSET,
 * so it carries the same shift as the collection registry
 * (`collectionRegistryRows`): a Single
 * deleted behind the cursor moves the rest back and one is never read. Here the
 * missed row could be a Single that HOLDS blocks, so a changed count is read as
 * a registry that cannot be read whole.
 */
export async function* singlesRegistryPages(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): AsyncGenerator<readonly unknown[] | typeof UNREADABLE_PAGE> {
  let expected: number | undefined;
  for (let offset = 0; ; offset += REGISTRY_PAGE_SIZE) {
    const listed: unknown = await ctx.services.singles.list({
      offset,
      limit: REGISTRY_PAGE_SIZE,
    });
    const rows = (listed as { data?: unknown }).data;
    const total = (listed as { total?: unknown }).total;
    if (!Array.isArray(rows) || typeof total !== "number") {
      yield UNREADABLE_PAGE;
      return;
    }
    expected ??= total;
    if (total !== expected) {
      yield UNREADABLE_PAGE;
      return;
    }
    yield rows;
    // Bounded by BOTH, so neither a `total` that disagrees with the rows nor an
    // empty page can spin this. An empty page with work still claimed is the
    // shape that would otherwise loop for ever.
    if (rows.length === 0 || offset + rows.length >= total) return;
  }
}

/** How many registry rows one page of the collection listing asks for. */
export const REGISTRY_PAGE_SIZE = 100;

/**
 * Every collection's registry record, page by page, for the schema
 * fingerprint the bindings report checks against. Refused when a page cannot
 * be read, so a fingerprint is never taken over part of the registry.
 */
export async function collectionRegistryRows(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const listed: unknown = await ctx.services.collections.listCollections(
      { page, limit: REGISTRY_PAGE_SIZE, sortBy: "slug", sortOrder: "asc" },
      undefined as never
    );
    const data = (listed as { data?: unknown }).data;
    const hasMore = (listed as { pagination?: { hasMore?: unknown } })
      .pagination?.hasMore;
    if (!Array.isArray(data) || typeof hasMore !== "boolean") {
      throw new Error(
        "[page-builder] the collection registry could not be read for the bindings report"
      );
    }
    rows.push(...data);
    if (!hasMore || data.length === 0) return rows;
  }
}

/** Every Single's registry record, for the same fingerprint. */
export async function singleRegistryRows(
  ctx: Parameters<NonNullable<Parameters<typeof definePlugin>[0]["init"]>>[0]
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for await (const page of singlesRegistryPages(ctx)) {
    if (page === UNREADABLE_PAGE) {
      throw new Error(
        "[page-builder] the Singles registry could not be read for the bindings report"
      );
    }
    rows.push(...page);
  }
  return rows;
}

/** How many field groups one read of the registry asks for. */
const FIELD_GROUP_PAGE_SIZE = 100;

/**
 * Every field group's registry record, for the same fingerprint: a binding
 * reaches a field group's fields where a collection or a Single places it, so
 * a change to one changes what those bindings are judged against.
 */
export async function fieldGroupRows(): Promise<unknown[]> {
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const nextly = await getCachedNextly();
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += FIELD_GROUP_PAGE_SIZE) {
    const page = await nextly.fieldGroups.find({
      limit: FIELD_GROUP_PAGE_SIZE,
      offset,
    });
    rows.push(...page.items);
    // Bounded by a short page, so an empty one ends the read.
    if (page.items.length < FIELD_GROUP_PAGE_SIZE) return rows;
  }
}
