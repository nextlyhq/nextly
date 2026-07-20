/**
 * Webhook domain — component reference expansion.
 *
 * `sensitiveFieldNames` only descends into a field's INLINE children, so a
 * component reference — which names its target by slug and carries no inline
 * fields — hides that component's own definitions from the walk. Any secret or
 * hidden field declared inside a component would then never reach the deny list
 * and would ship in the payload.
 *
 * This resolves each reference and grafts the component's fields onto it, so the
 * deny-list walk sees one complete tree. Resolution is injected rather than
 * imported so this stays pure and unit-testable.
 *
 * @module domains/webhooks/expand-component-fields
 */

import type { SensitiveFieldSource } from "./sensitive-fields";

/** Resolves a component slug to its field definitions, or null if unknown. */
export type ComponentFieldResolver = (
  slug: string
) => Promise<readonly SensitiveFieldSource[] | null>;

/**
 * Every component slug a component field can hold values for.
 *
 * Single-component mode names one target: `component` in config, or
 * `componentSlug` in the stored/dynamic shape. A dynamic zone instead lists the
 * component types an editor may pick from in `components`, and an instance of
 * ANY of them can end up stored in the field — so every listed slug has to be
 * expanded, or a hidden field inside whichever component the editor chose never
 * reaches the deny list.
 */
function referencedSlugs(field: SensitiveFieldSource): string[] {
  if (field.type !== "component") return [];
  const candidate = field as {
    component?: unknown;
    componentSlug?: unknown;
    components?: unknown;
  };

  const slugs: string[] = [];
  if (typeof candidate.componentSlug === "string")
    slugs.push(candidate.componentSlug);
  if (typeof candidate.component === "string") slugs.push(candidate.component);
  if (Array.isArray(candidate.components)) {
    for (const slug of candidate.components) {
      if (typeof slug === "string") slugs.push(slug);
    }
  }
  // A field could name the same slug twice (`component` plus a `components`
  // entry); resolution is memoized anyway, but deduping keeps the grafted tree
  // from carrying the component's fields more than once.
  return [...new Set(slugs)];
}

/** Memoized resolutions, so one slug is fetched at most once per expansion. */
type ResolutionCache = Map<string, readonly SensitiveFieldSource[] | null>;

async function resolveOnce(
  slug: string,
  resolve: ComponentFieldResolver,
  cache: ResolutionCache
): Promise<readonly SensitiveFieldSource[] | null> {
  const cached = cache.get(slug);
  // `undefined` means "not looked up yet"; a resolved miss is cached as null so
  // an unknown slug is not re-fetched either.
  if (cached !== undefined) return cached;
  const resolved = await resolve(slug);
  cache.set(slug, resolved);
  return resolved;
}

async function expandBlocks(
  blocks: SensitiveFieldSource["blocks"],
  resolve: ComponentFieldResolver,
  seen: ReadonlySet<string>,
  cache: ResolutionCache
): Promise<SensitiveFieldSource["blocks"]> {
  if (!blocks) return blocks;
  return Promise.all(
    blocks.map(async block => ({
      ...block,
      fields: block.fields
        ? await expandComponentFields(block.fields, resolve, seen, cache)
        : block.fields,
    }))
  );
}

/**
 * Return the field tree with every component reference replaced by a node that
 * carries the referenced component's fields.
 *
 * `seen` guards against a component that (directly or transitively) embeds
 * itself: without it a cycle would recurse until the stack gave out. It is
 * path-scoped, so it cannot double as a lookup cache — `cache` memoizes
 * resolutions across the whole expansion instead, keeping a component that two
 * sibling branches both reference to a single registry read on the write path.
 * An unresolvable slug is left as-is rather than throwing — a write must not
 * fail because a component record is missing, and the field carries no values of
 * its own to leak.
 */
export async function expandComponentFields(
  fields: readonly SensitiveFieldSource[],
  resolve: ComponentFieldResolver,
  seen: ReadonlySet<string> = new Set<string>(),
  cache: ResolutionCache = new Map()
): Promise<SensitiveFieldSource[]> {
  const expanded: SensitiveFieldSource[] = [];

  for (const field of fields) {
    const inline = field.fields
      ? await expandComponentFields(field.fields, resolve, seen, cache)
      : undefined;
    const blocks = await expandBlocks(field.blocks, resolve, seen, cache);

    // A dynamic zone contributes several; each is expanded under its own cycle
    // path so one self-referential member cannot suppress its siblings.
    const grafted: SensitiveFieldSource[] = [];
    for (const slug of referencedSlugs(field)) {
      if (seen.has(slug)) continue;
      const resolved = await resolveOnce(slug, resolve, cache);
      if (!resolved) continue;
      const nested = new Set(seen);
      nested.add(slug);
      grafted.push(
        ...(await expandComponentFields(resolved, resolve, nested, cache))
      );
    }

    if (grafted.length > 0) {
      expanded.push({
        ...field,
        // Merge rather than replace: a component field may also declare inline
        // children, and both sets must be visible to the deny-list walk.
        fields: [...(inline ?? []), ...grafted],
        ...(blocks ? { blocks } : {}),
      });
      continue;
    }

    expanded.push({
      ...field,
      ...(inline ? { fields: inline } : {}),
      ...(blocks ? { blocks } : {}),
    });
  }

  return expanded;
}
