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
 * The slug a component field points at. Config-defined fields name it
 * `component`; the stored/dynamic shape uses `componentSlug`. Both are read so
 * expansion works regardless of which layer produced the field.
 */
function referencedSlug(field: SensitiveFieldSource): string | undefined {
  if (field.type !== "component") return undefined;
  const candidate = field as {
    component?: unknown;
    componentSlug?: unknown;
  };
  if (typeof candidate.componentSlug === "string")
    return candidate.componentSlug;
  if (typeof candidate.component === "string") return candidate.component;
  return undefined;
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

    const slug = referencedSlug(field);
    if (slug && !seen.has(slug)) {
      const resolved = await resolveOnce(slug, resolve, cache);
      if (resolved) {
        const nested = new Set(seen);
        nested.add(slug);
        const componentFields = await expandComponentFields(
          resolved,
          resolve,
          nested,
          cache
        );
        expanded.push({
          ...field,
          // Merge rather than replace: a component field may also declare inline
          // children, and both sets must be visible to the deny-list walk.
          fields: [...(inline ?? []), ...componentFields],
          ...(blocks ? { blocks } : {}),
        });
        continue;
      }
    }

    expanded.push({
      ...field,
      ...(inline ? { fields: inline } : {}),
      ...(blocks ? { blocks } : {}),
    });
  }

  return expanded;
}
