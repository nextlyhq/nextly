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
  SITE_SETTING_FIELD_SHAPES,
  walkNodes,
  type BlockNode,
  type ResolvedBlockNode,
  type BindingDocument,
  type BindingFieldShape,
  type BindingSchemaRef,
  type BindingSchemaSource,
  type BlockDocument,
  type NamedQuerySource,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";

import type { StoredForms } from "./added-undefined-ids";
import {
  asFieldIssues,
  isStoredTemplate,
  nodesOf,
  placedComponents,
  TEMPLATE_TARGET_UNKNOWN,
  writeSettingOf,
  type TemplateTargets,
} from "./list-query-judgement";

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
  /**
   * The site's named queries, so a list's item bindings are judged against
   * the rows its query declares; absent, a named query's rows are unknown.
   */
  readonly namedQueries?: NamedQuerySource;
  /**
   * Where templates are stored and what a stored one draws, so a template's
   * bindings read the entry of the collection it draws, as its lists and
   * conditions are judged; absent, a template is judged as any entry.
   */
  readonly templates?: TemplateTargets;
}

/** A collection's or a Single's ref: the sources whose fields are read. */
export type ReadRef =
  | { readonly collection: string }
  | { readonly single: string };

/** A source's key in the read shapes. */
function keyOf(ref: ReadRef): string {
  return "collection" in ref
    ? `collection:${ref.collection}`
    : `single:${ref.single}`;
}

/**
 * The most sources one save reads the fields of. A document binding more is
 * refused, since past it a binding could not be judged: one left unknown
 * would be let through by its shape alone.
 */
const MAX_SOURCES = 32;

/** The issue a document binding more sources than one save reads gets. */
const OVER_LIMIT = {
  code: "binding-sources-over-limit",
  message: `This document binds more than ${String(MAX_SOURCES)} collections and Singles, more than one save can check. Bind fewer sources, or split the page.`,
} as const;

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
  write: Pick<PluginFieldWrite, "kind" | "slug">,
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
 * The entry a write's bindings read. A template's is the collection it
 * draws, by the one rule its lists and conditions are judged by
 * ({@link writeSettingOf}): the collection the write carries, or the one
 * stored; {@link TEMPLATE_TARGET_UNKNOWN} where neither can be read, and the
 * lists' judgement refuses that write once. Any other document's is its own
 * ({@link entryOf}).
 */
async function bindingEntryOf(
  write: PluginFieldWrite,
  document: unknown,
  data: Readonly<Record<string, unknown>>,
  templates: TemplateTargets | undefined
): Promise<BindingSchemaRef | undefined | typeof TEMPLATE_TARGET_UNKNOWN> {
  if (
    write.kind !== "collection" ||
    !isStoredTemplate(write.slug, document, templates)
  ) {
    return entryOf(write, document);
  }
  const setting = await writeSettingOf(write, document, data, templates);
  if (setting === TEMPLATE_TARGET_UNKNOWN) return TEMPLATE_TARGET_UNKNOWN;
  return typeof setting.entryCollection === "string"
    ? { collection: setting.entryCollection }
    : undefined;
}

/** What a judgement reads with, kept across its passes. */
interface SchemaReads {
  readonly shapesOf: DeclaredShapesReader;
  /** Every source read so far, `undefined` for one that could not be. */
  readonly known: Map<string, readonly BindingFieldShape[] | undefined>;
  /** Whether the walk reached more sources than one save reads. */
  overflowed: boolean;
  /** Whether a source's fields could not be read, leaving it unknown. */
  failed?: boolean;
  /** The named queries, whose declared rows a list's items bind against. */
  readonly namedQueries?: NamedQuerySource;
}

/**
 * The schema as read so far. A collection or a Single not read yet answers
 * unknown, and is noted in `wanted` when one is given; the site settings are
 * the engine's fixed table, the one the renderer reads, so a binding to a
 * setting a page is never handed is refused here as the page would fall it
 * back; and a named query's rows are its
 * declaration's own fields (a query whose rows are a collection's entries is
 * judged as that collection, by the walk).
 */
function schemaSoFar(
  reads: SchemaReads,
  wanted: Map<string, ReadRef> | undefined
): BindingSchemaSource {
  return {
    listsTimestamps: true,
    fieldsOf: ref => {
      if ("site" in ref) return SITE_SETTING_FIELD_SHAPES;
      if ("query" in ref) {
        const rows = reads.namedQueries?.declarationOf(ref.query)?.rows;
        return rows !== undefined && "fields" in rows ? rows.fields : undefined;
      }
      if (!("collection" in ref || "single" in ref)) return undefined;
      const key = keyOf(ref);
      if (reads.known.has(key)) return reads.known.get(key);
      if (wanted === undefined) return undefined;
      if (reads.known.size + wanted.size < MAX_SOURCES) wanted.set(key, ref);
      else reads.overflowed = true;
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
        // A Single the binding names that does not exist has no fields, so
        // a path into it is missing. A collection is only ever the page's
        // own or one a relation leads into, which the schema names; one the
        // registry does not hold is a built-in such as `media` or `users`,
        // whose fields are kept apart, so it is left unknown.
        const read = await reads.shapesOf(ref);
        shapes = read ?? ("single" in ref ? [] : undefined);
      } catch {
        // A read that failed leaves it unknown, so nothing is judged
        // against it, and the judgement says it is not complete.
        shapes = undefined;
        reads.failed = true;
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
      ...(judging.reads.namedQueries === undefined
        ? {}
        : { namedQueries: judging.reads.namedQueries }),
    }).filter(isErrorIssue);
    if (wanted === undefined || wanted.size === 0) return issues;
    await readSources(judging.reads, wanted);
  }
}

/** One binding error, as the engine names it. */
type BindingError = Awaited<ReturnType<typeof bindingErrors>>[number];

/**
 * The binding errors in `document` that `keep` counts, against the declared
 * schema: a problem a stored form already held is kept rather than refused, so
 * the stored forms are read only once a problem is found; where they cannot be
 * read, every problem is kept.
 */
async function judgedErrors(
  document: BindingDocument,
  entry: BindingSchemaRef | undefined,
  site: BindingJudging & { readonly shapesOf: DeclaredShapesReader },
  keep: (issue: BindingError) => boolean
): Promise<{ readonly found: BindingError[]; readonly overflowed: boolean }> {
  // One read of each source, for the write and its stored forms alike, so
  // both verdicts are against the same schema.
  const reads: SchemaReads = {
    shapesOf: site.shapesOf,
    known: new Map(),
    overflowed: false,
    ...(site.namedQueries === undefined
      ? {}
      : { namedQueries: site.namedQueries }),
  };
  const judging = { reads, entry, maxNodes: site.maxNodes };
  const found = (
    await bindingErrors(document, { ...judging, stored: [] })
  ).filter(keep);
  // Past the cap nothing more is read, so no verdict can be given.
  if (reads.overflowed) return { found: [], overflowed: true };
  if (found.length === 0 || site.storedForms === undefined) {
    return { found, overflowed: false };
  }
  const snapshot = await site.storedForms();
  // A stored page this cannot read may already hold every problem found, so
  // none is refused: nothing can tell a new one from one the page held.
  if (!snapshot.readable) {
    site.onUnjudged?.(found.length);
    return { found: [], overflowed: false };
  }
  // Nothing stored (a create) holds no problem, so every one is the write's.
  if (snapshot.forms.length === 0) return { found, overflowed: false };
  const held = (
    await bindingErrors(document, { ...judging, stored: snapshot.forms })
  ).filter(keep);
  return { found: held, overflowed: reads.overflowed };
}

/** A document's binding problems now, and the declared fields they were read against. */
export interface CurrentBindingProblems {
  /** Every problem, held or not, as the engine names it. */
  readonly found: readonly BindingError[];
  /** Whether it binds more sources than one judgement reads; then `found` is empty. */
  readonly overflowed: boolean;
  /** Whether a source's fields could not be read, so `found` may miss some. */
  readonly incomplete: boolean;
  /** The declared fields of each source read, or `undefined` for one unknown. */
  readonly fieldsOf: (ref: ReadRef) => readonly BindingFieldShape[] | undefined;
}

/**
 * Every binding problem a document has now, against the declared schema, as
 * the report of documents to fix lists them: a problem the stored page already
 * held counts too, since the report is of what is broken, not of what a write
 * broke. The same judgement, and the same reads, as a save's.
 */
export async function currentBindingProblems(
  document: BindingDocument,
  entry: BindingSchemaRef | undefined,
  site: {
    readonly shapesOf: DeclaredShapesReader;
    readonly maxNodes?: number;
    readonly namedQueries?: NamedQuerySource;
  }
): Promise<CurrentBindingProblems> {
  const reads: SchemaReads = {
    shapesOf: site.shapesOf,
    known: new Map(),
    overflowed: false,
    ...(site.namedQueries === undefined
      ? {}
      : { namedQueries: site.namedQueries }),
  };
  const found = await bindingErrors(document, {
    reads,
    entry,
    maxNodes: site.maxNodes,
    stored: [],
  });
  return {
    found: reads.overflowed ? [] : found,
    overflowed: reads.overflowed,
    incomplete: reads.failed === true,
    fieldsOf: ref => reads.known.get(keyOf(ref)),
  };
}

/**
 * Whether a write's bindings are judged at all: the schema is read through
 * the pool, which inside a transaction is another connection. It can wait
 * behind the one the transaction holds, and nothing a validation is handed
 * reads the registry on the transaction's own. So a write in a transaction (an
 * action route, a batch, an import) is not judged here, as its breakpoints
 * are not; the page still falls back by the same rule where it renders.
 */
function judges(
  write: PluginFieldWrite | undefined
): write is PluginFieldWrite {
  return write !== undefined && !write.inTransaction;
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
  if (nodes === undefined || !judges(args.write) || shapesOf === undefined) {
    return [];
  }
  const entry = await bindingEntryOf(
    args.write,
    value,
    args.data,
    site.templates
  );
  // A template whose collection can't be known: its lists' judgement refuses
  // the write, once, rather than its bindings judged against no entry.
  if (entry === TEMPLATE_TARGET_UNKNOWN) return [];
  const document: BindingDocument = {
    nodes,
    settings: (value as { settings?: unknown }).settings,
  };
  const judged = await judgedErrors(
    document,
    entry,
    { ...site, shapesOf },
    () => true
  );
  if (judged.overflowed) {
    return [
      {
        path: args.path,
        code: OVER_LIMIT.code,
        message: `${label}: ${OVER_LIMIT.message}`,
      },
    ];
  }
  return asFieldIssues(judged.found, args, label);
}

/** A binding problem a placed component brings to a page. */
export interface ComposedBindingIssue {
  readonly code: string;
  readonly message: string;
}

/**
 * The binding problems of the blocks a page's placed components put on it,
 * as the page composes them, against the page's own entry. A component's own
 * save judges no binding to the entry, which is each placing page's; so a
 * binding the page's entry cannot fill is refused where the page places it,
 * named by the component it comes through. The page's own blocks and
 * metadata are {@link newBindingIssues}'s. A problem the stored page already
 * composed to is kept, as for the page's own bindings.
 */
export async function composedBindingIssues(
  composed: unknown,
  host: BlockDocument,
  write: PluginFieldWrite,
  site: BindingJudging,
  /** The write's data, where a template names the collection it draws. */
  data: Readonly<Record<string, unknown>> = {}
): Promise<ComposedBindingIssue[]> {
  const nodes = nodesOf(composed);
  const shapesOf = site.shapesOf;
  const entry = await bindingEntryOf(write, host, data, site.templates);
  if (
    nodes === undefined ||
    !judges(write) ||
    shapesOf === undefined ||
    entry === undefined ||
    entry === TEMPLATE_TARGET_UNKNOWN
  ) {
    return [];
  }
  // Each composed node a definition put here, by the host's own placement.
  const placedNodes = new Map<string, string>();
  walkNodes(
    nodes as BlockNode[],
    node => {
      const through = (node as ResolvedBlockNode).instanceOf;
      if (typeof through === "string") placedNodes.set(node.id, through);
    },
    site.maxNodes === undefined ? {} : { maxNodes: site.maxNodes }
  );
  if (placedNodes.size === 0) return [];
  const { found, overflowed } = await judgedErrors(
    { nodes },
    entry,
    { ...site, shapesOf },
    issue => placedNodes.has(issue.nodeId)
  );
  if (overflowed) return [OVER_LIMIT];
  if (found.length === 0) return [];
  const componentOf = placedComponents(host, site.maxNodes);
  return found.map(issue => {
    const component = componentOf.get(placedNodes.get(issue.nodeId) ?? "");
    return {
      code: issue.code,
      message: `${component === undefined ? "A component" : `Component "${component}"`}, as this page places it, holds a binding this page can't fill. ${issue.message}`,
    };
  });
}
