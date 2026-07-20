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

async function expandBlocks(
  blocks: SensitiveFieldSource["blocks"],
  resolve: ComponentFieldResolver,
  seen: ReadonlySet<string>
): Promise<SensitiveFieldSource["blocks"]> {
  if (!blocks) return blocks;
  return Promise.all(
    blocks.map(async block => ({
      ...block,
      fields: block.fields
        ? await expandComponentFields(block.fields, resolve, seen)
        : block.fields,
    }))
  );
}

/**
 * Return the field tree with every component reference replaced by a node that
 * carries the referenced component's fields.
 *
 * `seen` guards against a component that (directly or transitively) embeds
 * itself: without it a cycle would recurse until the stack gave out. An
 * unresolvable slug is left as-is rather than throwing — a write must not fail
 * because a component record is missing, and the field carries no values of its
 * own to leak.
 */
export async function expandComponentFields(
  fields: readonly SensitiveFieldSource[],
  resolve: ComponentFieldResolver,
  seen: ReadonlySet<string> = new Set<string>()
): Promise<SensitiveFieldSource[]> {
  const expanded: SensitiveFieldSource[] = [];

  for (const field of fields) {
    const inline = field.fields
      ? await expandComponentFields(field.fields, resolve, seen)
      : undefined;
    const blocks = await expandBlocks(field.blocks, resolve, seen);

    const slug = referencedSlug(field);
    if (slug && !seen.has(slug)) {
      const resolved = await resolve(slug);
      if (resolved) {
        const nested = new Set(seen);
        nested.add(slug);
        const componentFields = await expandComponentFields(
          resolved,
          resolve,
          nested
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
