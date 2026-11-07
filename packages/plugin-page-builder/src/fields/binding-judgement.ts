/**
 * A blocks write's bindings judged against the declared schema of what they
 * read, as the save judges them.
 *
 * The engine's `bindingSchemaIssues` is the one rule, the same `checkBinding`
 * the renderer falls back by, on blocks and in the document's own metadata.
 * This reads what it needs: the declared fields of the sources the write
 * binds (the page's entry, each Single, and the collection a path's relation
 * leads into, through any groups on the way), and only those. Which sources
 * those are is asked of the rule's own walk, so every path it can follow is
 * read for, and nothing past the document's node cap. Declared, not public:
 * binding a field visitors may not read is allowed, and the published page
 * shows the binding's fallback.
 *
 * A problem the stored page already held stays a warning, so a page whose
 * binding a schema change broke (a field renamed, a prop's type changed) is
 * saved again with its binding kept, rather than becoming unsavable.
 *
 * @module binding-judgement
 */
import {
  bindingSchemaIssues,
  isErrorIssue,
  registryBlockSource,
  type BindingDocument,
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

/**
 * The declared fields of one source, or `undefined` for no such source; a
 * read that fails throws, and leaves the source unknown.
 */
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

/** A collection's or a Single's ref: the sources whose fields are read. */
type ReadRef = { readonly collection: string } | { readonly single: string };

/** A source's key in the read shapes. */
function keyOf(ref: ReadRef): string {
  return "collection" in ref
    ? `collection:${ref.collection}`
    : `single:${ref.single}`;
}

/**
 * The most sources one save reads the fields of. Past it, a source is left
 * unknown, and its bindings are judged by their shape alone, as an unreadable
 * source's are: a write naming more is refused nothing it would not be
 * refused for anyway, and costs no more reads.
 */
const MAX_SOURCES = 32;

/**
 * How many times the walk is asked which sources it reached unread: the
 * entry and the Singles first, then the collections their relations lead
 * into, since a path follows one relation. The last ask records nothing.
 */
const MAX_READ_ROUNDS = 3;

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

/** What a judgement reads with, kept across its passes. */
interface SchemaReads {
  readonly shapesOf: DeclaredShapesReader;
  /** Every source read so far, `undefined` for one that could not be. */
  readonly known: Map<string, readonly BindingFieldShape[] | undefined>;
}

/**
 * The schema as read so far. A collection or a Single not read yet answers
 * unknown, and is noted in `wanted` when one is given; the site settings and
 * a named query's rows are never read here: their fields are a fixed set, or
 * declared by the query.
 */
function schemaSoFar(
  reads: SchemaReads,
  wanted: Map<string, ReadRef> | undefined
): BindingSchemaSource {
  return {
    listsTimestamps: true,
    fieldsOf: ref => {
      if (!("collection" in ref || "single" in ref)) return undefined;
      const key = keyOf(ref);
      if (reads.known.has(key)) return reads.known.get(key);
      if (
        wanted !== undefined &&
        reads.known.size + wanted.size < MAX_SOURCES
      ) {
        wanted.set(key, ref);
      }
      return undefined;
    },
  };
}

/** Read each wanted source's declared fields, all at once. */
async function readSources(
  reads: SchemaReads,
  wanted: ReadonlyMap<string, ReadRef>
): Promise<void> {
  await Promise.all(
    [...wanted].map(async ([key, ref]) => {
      let shapes: readonly BindingFieldShape[] | undefined;
      try {
        // A source that does not exist has no fields, so a path into it is
        // missing, not unknown.
        shapes = (await reads.shapesOf(ref)) ?? [];
      } catch {
        // A read that failed leaves it unknown, so nothing is judged
        // against it.
        shapes = undefined;
      }
      reads.known.set(key, shapes);
    })
  );
}

/**
 * A document's binding errors, against the declared fields of what it binds:
 * the walk is asked which sources it reached unread, they are read, and it is
 * asked again until it reaches none new.
 */
async function bindingErrors(
  document: BindingDocument,
  judging: {
    readonly reads: SchemaReads;
    readonly entry: BindingSchemaRef | undefined;
    readonly stored: readonly BlockDocument[];
    readonly maxNodes: number | undefined;
  }
): Promise<ReturnType<typeof bindingSchemaIssues>> {
  for (let round = 0; ; round += 1) {
    const wanted =
      round < MAX_READ_ROUNDS ? new Map<string, ReadRef>() : undefined;
    const issues = bindingSchemaIssues(document, {
      schema: schemaSoFar(judging.reads, wanted),
      ...(judging.entry === undefined ? {} : { entry: judging.entry }),
      definitions: registryBlockSource(),
      ...(judging.stored.length === 0 ? {} : { stored: judging.stored }),
      ...(judging.maxNodes === undefined ? {} : { maxNodes: judging.maxNodes }),
    }).filter(isErrorIssue);
    if (wanted === undefined || wanted.size === 0) return issues;
    await readSources(judging.reads, wanted);
  }
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
  // The schema is read through the pool, which inside a transaction is
  // another connection: it can wait behind the one the transaction holds,
  // and nothing a validation is handed reads the registry on the
  // transaction's own. So a write in a transaction (an action route, a
  // batch, an import) is not judged here, as its breakpoints are not; the
  // page still falls back by the same rule where it renders.
  if (
    nodes === undefined ||
    args.write === undefined ||
    args.write.inTransaction ||
    shapesOf === undefined
  ) {
    return [];
  }
  const document: BindingDocument = {
    nodes,
    settings: (value as { settings?: unknown }).settings,
  };
  // One read of each source, for the write and its stored forms alike, so
  // both verdicts are against the same schema.
  const reads: SchemaReads = { shapesOf, known: new Map() };
  const judging = {
    reads,
    entry: entryOf(args.write, value),
    maxNodes: site.maxNodes,
  };
  const found = await bindingErrors(document, { ...judging, stored: [] });
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
    snapshot.forms.length > 0
      ? await bindingErrors(document, { ...judging, stored: snapshot.forms })
      : found,
    args,
    label
  );
}
