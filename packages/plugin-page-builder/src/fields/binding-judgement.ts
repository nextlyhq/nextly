/**
 * A blocks write's bindings judged against the declared schema of what they
 * read, as the save judges them.
 *
 * The engine's `bindingSchemaIssues` is the one rule, the same `checkBinding`
 * the renderer falls back by. This reads what it needs: the declared fields of
 * the sources the write binds (the page's entry, each Single, and the
 * collection a path's relation leads into), and only those. Declared, not
 * public: binding a field visitors may not read is allowed, and the published
 * page shows the binding's fallback.
 *
 * A problem the stored page already held stays a warning, so a page whose
 * binding a schema change broke (a field renamed, a prop's type changed) is
 * saved again with its binding kept, rather than becoming unsavable.
 *
 * @module binding-judgement
 */
import {
  bindingDemand,
  bindingSchemaIssues,
  isErrorIssue,
  registryBlockSource,
  type BindingFieldShape,
  type BindingSchemaRef,
  type BindingSchemaSource,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import type { StoredForms } from "./added-undefined-ids";
import { asFieldIssues, nodesOf } from "./list-query-judgement";

/** The declared fields of one source, or `undefined` for no such source. */
export type DeclaredShapesReader = (
  ref: { readonly collection: string } | { readonly single: string }
) => Promise<readonly BindingFieldShape[] | undefined>;

/** What a write's bindings are judged with, besides the write. */
export interface BindingJudging {
  /** The schema; absent where it cannot be read, and then nothing is judged. */
  readonly shapesOf?: DeclaredShapesReader;
  /** The forms the page is stored as, read only once a problem is found. */
  readonly storedForms?: () => Promise<StoredForms>;
  readonly maxNodes?: number;
  /** Told how many problems were kept unjudged for an unreadable store. */
  readonly onUnjudged?: (kept: number) => void;
}

/** A source's key in the read shapes. */
function keyOf(
  ref: { readonly collection: string } | { readonly single: string }
): string {
  return "collection" in ref
    ? `collection:${ref.collection}`
    : `single:${ref.single}`;
}

/**
 * The page's entry, as its renderer reads it: a collection's entry or a
 * Single. A component's own document has none: a placed component reads the
 * entry of each page placing it.
 */
function entryOf(
  write: PluginFieldWrite,
  document: unknown
): BindingSchemaRef | undefined {
  if (
    typeof document === "object" &&
    document !== null &&
    (document as { kind?: unknown }).kind === "component"
  ) {
    return undefined;
  }
  return write.kind === "collection"
    ? { collection: write.slug }
    : { single: write.slug };
}

/**
 * The declared shapes of every source the forests bind, read once each: the
 * entry and each Single their bindings name, and the collection each of
 * their paths' relations leads into. A source that cannot be read is left
 * unknown, so nothing is judged against it.
 */
async function schemaFor(
  forests: readonly (readonly unknown[])[],
  entry: BindingSchemaRef | undefined,
  shapesOf: DeclaredShapesReader
): Promise<BindingSchemaSource> {
  const known = new Map<string, readonly BindingFieldShape[] | undefined>();
  const read = async (
    ref: { readonly collection: string } | { readonly single: string }
  ) => {
    const key = keyOf(ref);
    if (known.has(key)) return known.get(key);
    let shapes: readonly BindingFieldShape[] | undefined;
    try {
      shapes = await shapesOf(ref);
    } catch {
      shapes = undefined;
    }
    known.set(key, shapes);
    return shapes;
  };
  const demand = bindingDemand(
    forests.map(
      nodes => ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument
    )
  );
  const sources: (readonly [
    { readonly collection: string } | { readonly single: string },
    ReadonlyMap<string, readonly string[]>,
  ])[] = [
    ...(demand.entry === undefined || entry === undefined || "site" in entry
      ? []
      : [[entry, demand.entry.follows] as const]),
    ...[...demand.singles].map(
      ([slug, wanted]) => [{ single: slug }, wanted.follows] as const
    ),
  ];
  for (const [ref, follows] of sources) {
    const fields = await read(ref);
    for (const name of follows.keys()) {
      const target = fields?.find(field => field.name === name)?.relationTo;
      if (typeof target === "string") await read({ collection: target });
    }
  }
  return {
    fieldsOf: ref => ("site" in ref ? undefined : known.get(keyOf(ref))),
  };
}

/**
 * The issues a write is refused with for its bindings; empty when every
 * binding fits, or when nothing can tell a new problem from one the page
 * already held.
 */
export async function newBindingIssues(
  value: unknown,
  args: PluginFieldValidateArgs,
  label: string,
  site: BindingJudging
): Promise<PluginFieldIssue[]> {
  const nodes = nodesOf(value);
  const shapesOf = site.shapesOf;
  if (
    nodes === undefined ||
    args.write === undefined ||
    shapesOf === undefined
  ) {
    return [];
  }
  const entry = entryOf(args.write, value);
  const judge = async (stored: readonly BlockDocument[]) => {
    const forests = [
      nodes,
      ...stored.flatMap(form => {
        const forest = nodesOf(form);
        return forest === undefined ? [] : [forest];
      }),
    ];
    return bindingSchemaIssues(nodes, {
      schema: await schemaFor(forests, entry, shapesOf),
      ...(entry === undefined ? {} : { entry }),
      definitions: registryBlockSource(),
      ...(stored.length === 0 ? {} : { stored }),
      ...(site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }),
    }).filter(isErrorIssue);
  };
  const found = await judge([]);
  if (found.length === 0 || site.storedForms === undefined) {
    return asFieldIssues(found, args, label);
  }
  const snapshot = await site.storedForms();
  // A stored page this cannot read may already hold every problem found, so
  // none is refused: nothing can tell a new one from one the page held.
  if (!snapshot.readable) {
    site.onUnjudged?.(found.length);
    return [];
  }
  // Nothing stored (a create) holds no problem, so every one is the write's.
  return asFieldIssues(
    snapshot.forms.length > 0 ? await judge(snapshot.forms) : found,
    args,
    label
  );
}
