/**
 * Filling bound props with their sources' values, before blocks render.
 *
 * One pass over a document turns each node's bindings into ordinary props, so
 * a block, core or contributed, never sees a binding: it receives a value of
 * the type its prop declares, or the binding's fallback, or the prop's own
 * value. Every binding is checked first (`binding-rules`), and a value that
 * breaks a rule never reaches a block.
 *
 * A list item's bindings cannot be filled here, because the item is only known
 * while the list draws it. They are left in place and filled the same way,
 * with {@link resolveNodeBindings}, when the item's copy of the node renders.
 *
 * The pass reads nothing. Its sources arrive already read, which is what keeps
 * it synchronous and pure, and what lets the caller decide who the reads are
 * made as.
 *
 * @module resolve-bindings
 */
import {
  createBindingFormatter,
  machineDate,
  safeTimeZone,
  supportedLocale,
  type BindingFormatter,
  type CheckedFormat,
  type FormatEnv,
} from "./binding-format";
import type { BindingIssue, BindingIssueCode } from "./binding-issues";
import {
  checkBinding,
  isBindPath,
  isEmptyBoundValue,
  isValidPropValue,
  type BindingFieldShape,
  type BindingRefs,
  type BindingSchemaRef,
  type BindingSchemaSource,
  type CheckedBinding,
} from "./binding-rules";
import type { PropSchema } from "./block";
import {
  DEFAULT_BINDING_SOURCE,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { isPlainRecord } from "./plain-record";
import { defineEntry, ownEntry, ownKeys } from "./safe-record";

/**
 * The values a page's bindings read, already read.
 *
 * `undefined` means the source was not read for this page, and its bindings
 * fall back and are reported. `null` means it was read and holds nothing a
 * visitor may see, and its bindings fall back quietly, as an empty field does.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingSources {
  /** The entry the page shows, as the public reads it. */
  readonly entry?: Readonly<Record<string, unknown>> | null;
  /** Each Single the page binds, by slug. */
  readonly singles?: ReadonlyMap<
    string,
    Readonly<Record<string, unknown>> | null
  >;
  /** The site settings the public may read. */
  readonly site?: Readonly<Record<string, unknown>> | null;
}

/**
 * Where a block's declared props are looked up: a block resolver, or any
 * lookup answering with a definition's `props`.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BlockPropsLookup {
  get(
    type: string
  ):
    | { readonly props?: Readonly<Partial<Record<string, PropSchema>>> }
    | undefined;
}

/**
 * What a render's binding pass is given.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingRunInput {
  readonly sources: BindingSources;
  /** The schema ref of the entry the page shows. */
  readonly entryRef?: BindingSchemaRef;
  /** The sources' field shapes; without them values are judged by shape. */
  readonly schema?: BindingSchemaSource;
  /** The page's language; English when absent or unknown to the runtime. */
  readonly locale?: string;
  /** The site's time zone, for date-times; UTC when absent or invalid. */
  readonly timeZone?: string;
  readonly props: BlockPropsLookup;
}

/**
 * One render's binding pass: its inputs, and the formatters it has built.
 *
 * Made once per render and shared by the page's pass and every list item's,
 * so a formatter is built once however many entries a list shows.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingRun {
  readonly sources: BindingSources;
  readonly entryRef?: BindingSchemaRef;
  readonly schema?: BindingSchemaSource;
  readonly props: BlockPropsLookup;
  readonly env: FormatEnv;
  /** False when a time zone was given and refused, so UTC is used instead. */
  readonly timeZoneValid: boolean;
  readonly formatter: BindingFormatter;
}

/**
 * The language a page formats in when it states none the runtime knows.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const DEFAULT_BINDING_LOCALE = "en";

/**
 * Start a render's binding pass.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function createBindingRun(input: BindingRunInput): BindingRun {
  const zone = safeTimeZone(input.timeZone);
  const env: FormatEnv = {
    locale: supportedLocale(input.locale) ?? DEFAULT_BINDING_LOCALE,
    timeZone: zone.zone,
  };
  return {
    sources: input.sources,
    ...(input.entryRef === undefined ? {} : { entryRef: input.entryRef }),
    ...(input.schema === undefined ? {} : { schema: input.schema }),
    props: input.props,
    env,
    timeZoneValid: zone.valid,
    formatter: createBindingFormatter(env),
  };
}

/**
 * What a bound prop's value is, for a block that wants more than the value.
 *
 * - `date`: a date formatted to text; `datetime` is its machine-readable
 *   value, as `<time datetime>` takes it.
 * - `value`: the source's value, used as it is.
 * - `fallback`: the binding's fallback, because the value was empty or the
 *   binding could not be used.
 *
 * A prop showing its own value has no entry.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BoundValue =
  | {
      readonly kind: "date";
      readonly datetime: string;
      readonly dateOnly: boolean;
    }
  | { readonly kind: "value" }
  | { readonly kind: "fallback" };

/**
 * Each bound prop of one node, by prop name.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BoundValues = Readonly<Record<string, BoundValue>>;

/**
 * Which bindings a pass fills: the page's, or one list item's.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type BindingScope =
  | { readonly phase: "page" }
  | {
      readonly phase: "item";
      /** The item being drawn; absent outside a list. */
      readonly item?: Readonly<Record<string, unknown>>;
      /** The item's schema ref, when its collection is known. */
      readonly itemRef?: BindingSchemaRef;
    };

/**
 * One node's props after its bindings in a scope were filled.
 *
 * `props` is the node's own object when nothing was filled.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface NodeBindingResult {
  readonly props: Record<string, unknown>;
  readonly bound: BoundValues | undefined;
  readonly issues: readonly BindingIssue[];
}

/** A value read at a path, or nothing when any step is not a record. */
function readPath(
  source: Readonly<Record<string, unknown>> | null,
  segments: readonly string[]
): unknown {
  let current: unknown = source;
  for (const segment of segments) {
    if (!isPlainRecord(current)) return undefined;
    current = ownEntry(current, segment);
  }
  return current;
}

/** The record a binding reads, `null` for a source holding nothing, or `undefined` when unread. */
function sourceOf(
  binding: CheckedBinding,
  run: BindingRun,
  scope: BindingScope
): Readonly<Record<string, unknown>> | null | undefined {
  switch (binding.source) {
    case "entry":
      return run.sources.entry;
    case "site":
      return run.sources.site;
    case "single":
      return binding.sourceKey === undefined
        ? undefined
        : run.sources.singles?.get(binding.sourceKey);
    case "item":
      return scope.phase === "item" ? scope.item : undefined;
  }
}

/** A value shaped for its prop, or why it cannot be. */
type Shaped =
  | { readonly ok: true; readonly value: unknown; readonly bound: BoundValue }
  | {
      readonly ok: false;
      readonly code: BindingIssueCode;
      readonly message: string;
    };

const VALUE: BoundValue = { kind: "value" };
const FALLBACK: BoundValue = { kind: "fallback" };

/** A value formatted to text, with a date's machine value beside it. */
function shapeFormatted(
  format: CheckedFormat,
  field: BindingFieldShape | undefined,
  value: unknown,
  run: BindingRun
): Shaped {
  const formatted = run.formatter.format(value, format, field);
  if (formatted.ok) {
    const { text, date } = formatted.value;
    return {
      ok: true,
      value: text,
      bound: date === undefined ? VALUE : { kind: "date", ...date },
    };
  }
  return formatted.reason === "formatter"
    ? {
        ok: false,
        code: "binding-format-invalid",
        message: "This binding's format could not be built in this runtime.",
      }
    : {
        ok: false,
        code: "binding-type-misfit",
        message: `This binding's value cannot be shown with a ${format.type} format.`,
      };
}

/** Turn a non-empty source value into the value its prop is filled with. */
function shapeValue(
  binding: CheckedBinding,
  value: unknown,
  run: BindingRun
): Shaped {
  const { kind, propSchema } = binding;
  if (kind === undefined || propSchema === undefined) {
    return { ok: true, value, bound: VALUE };
  }
  if (binding.format !== null) {
    return shapeFormatted(binding.format, binding.field, value, run);
  }
  if (kind === "date") {
    const date = machineDate(value, binding.field);
    return date === undefined
      ? misfitValue(kind)
      : { ok: true, value: date.datetime, bound: { kind: "date", ...date } };
  }
  return isValidPropValue(kind, propSchema, value)
    ? { ok: true, value, bound: VALUE }
    : misfitValue(kind);
}

function misfitValue(kind: string): Shaped {
  return {
    ok: false,
    code: "binding-type-misfit",
    message: `This binding's value is not a ${kind} value, so its fallback is shown.`,
  };
}

/** Whether a binding is filled in this scope. */
function inScope(binding: unknown, scope: BindingScope): boolean {
  const source = isPlainRecord(binding)
    ? ownEntry(binding, "source")
    : undefined;
  return scope.phase === "item" ? source === "item" : source !== "item";
}

/** The fill one binding gives, or nothing to leave the prop's own value. */
type Fill = { readonly value: unknown; readonly bound: BoundValue } | undefined;

function fallbackFill(fallback: { readonly value: unknown } | undefined): Fill {
  return fallback === undefined
    ? undefined
    : { value: fallback.value, bound: FALLBACK };
}

/** Resolve one checked binding to its fill, reporting what went wrong. */
function fillOf(
  binding: CheckedBinding,
  run: BindingRun,
  scope: BindingScope,
  nodeId: string,
  issues: BindingIssue[]
): Fill | "none" {
  // An image is checked like any prop, and is filled once a bound image
  // carries its whole media object; until then it keeps its own value.
  if (binding.kind === "image") return "none";
  const source = sourceOf(binding, run, scope);
  if (source === undefined) {
    issues.push({
      nodeId,
      prop: binding.prop,
      code: "binding-source-unavailable",
      message:
        binding.source === "item"
          ? "This binding reads a list item, and this block is not inside a list."
          : `This binding's ${binding.source} source was not read for this page.`,
      path: binding.path,
    });
    return fallbackFill(binding.fallback);
  }
  const value = readPath(source, binding.segments);
  if (isEmptyBoundValue(value)) return fallbackFill(binding.fallback);
  const shaped = shapeValue(binding, value, run);
  if (!shaped.ok) {
    issues.push({
      nodeId,
      prop: binding.prop,
      code: shaped.code,
      message: shaped.message,
      path: binding.path,
    });
    return fallbackFill(binding.fallback);
  }
  return { value: shaped.value, bound: shaped.bound };
}

/** The schema refs of the entry, and of the item when one is being drawn. */
function refsFor(run: BindingRun, scope: BindingScope): BindingRefs {
  const item =
    scope.phase === "item" && scope.itemRef !== undefined
      ? { item: scope.itemRef }
      : {};
  return run.entryRef === undefined ? item : { entry: run.entryRef, ...item };
}

/** One binding, checked and then filled, or nothing to leave the own value. */
function fillBinding(
  at: {
    readonly node: BlockNode;
    readonly prop: string;
    readonly binding: unknown;
    readonly props: Readonly<Partial<Record<string, PropSchema>>>;
    readonly refs: BindingRefs;
  },
  run: BindingRun,
  scope: BindingScope,
  issues: BindingIssue[]
): Fill {
  const check = checkBinding({
    nodeId: at.node.id,
    prop: at.prop,
    binding: at.binding,
    props: at.props,
    ...(run.schema === undefined ? {} : { schema: run.schema }),
    refs: at.refs,
  });
  issues.push(...check.issues);
  if (check.outcome === "ignore") return undefined;
  if (check.outcome === "fallback") return fallbackFill(check.fallback);
  const fill = fillOf(check.binding, run, scope, at.node.id, issues);
  return fill === "none" ? undefined : fill;
}

/** The props a node's definition declares, or nothing when it cannot be read. */
function declaredProps(
  node: BlockNode,
  run: BindingRun
): Readonly<Partial<Record<string, PropSchema>>> | undefined {
  const definition = run.props.get(node.type);
  if (definition === undefined) return undefined;
  return definition.props ?? {};
}

/**
 * Fill one node's bindings in a scope.
 *
 * Total: a binding of any shape, a source of any shape and a definition whose
 * props cannot be read each give the node's own props back, never a throw.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function resolveNodeBindings(
  node: BlockNode,
  run: BindingRun,
  scope: BindingScope
): NodeBindingResult {
  const unchanged: NodeBindingResult = {
    props: node.props,
    bound: undefined,
    issues: [],
  };
  const bindings: unknown = node.bindings;
  if (!isPlainRecord(bindings)) return unchanged;
  try {
    const props = declaredProps(node, run);
    // A node no definition answers for draws a placeholder, so nothing of it
    // is read.
    if (props === undefined) return unchanged;
    const refs = refsFor(run, scope);
    const issues: BindingIssue[] = [];
    const filled: Record<string, unknown> = {};
    const bound: Record<string, BoundValue> = {};
    for (const prop of ownKeys(bindings)) {
      const binding = ownEntry(bindings, prop);
      if (!inScope(binding, scope)) continue;
      const fill = fillBinding(
        { node, prop, binding, props, refs },
        run,
        scope,
        issues
      );
      if (fill === undefined) continue;
      defineEntry(filled, prop, fill.value);
      defineEntry(bound, prop, fill.bound);
    }
    if (ownKeys(bound).length === 0) {
      return { props: node.props, bound: undefined, issues };
    }
    return { props: { ...node.props, ...filled }, bound, issues };
  } catch {
    // A definition is plugin code, and its props may be behind a getter that
    // throws. The node keeps its own props rather than failing the page.
    return unchanged;
  }
}

/**
 * A document with its page bindings filled.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BoundDocument {
  /** The same object as the input when nothing was filled. */
  readonly document: BlockDocument;
  /** What each filled prop holds, by node id. */
  readonly bound: ReadonlyMap<string, BoundValues>;
  readonly issues: readonly BindingIssue[];
}

/**
 * Fill every page binding in a document: the entry's, the Singles' and the
 * site's, in every stored slot. List items' bindings are left for the list to
 * fill.
 *
 * Returns the input document, by reference, when no node changed, so a page
 * with no bindings reads as unchanged to anything comparing stages.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindDocument(
  document: BlockDocument,
  run: BindingRun
): BoundDocument {
  const bound = new Map<string, BoundValues>();
  const issues: BindingIssue[] = [];
  const page: BindingScope = { phase: "page" };

  const bindNodes = (nodes: BlockNode[]): BlockNode[] => {
    let changed = false;
    const out = nodes.map(node => {
      const next = bindNode(node);
      if (next !== node) changed = true;
      return next;
    });
    return changed ? out : nodes;
  };

  const bindNode = (node: BlockNode): BlockNode => {
    const result = resolveNodeBindings(node, run, page);
    issues.push(...result.issues);
    if (result.bound !== undefined) bound.set(node.id, result.bound);
    const slots = bindSlots(node.slots);
    if (result.props === node.props && slots === node.slots) return node;
    return {
      ...node,
      props: result.props,
      ...(slots === undefined ? {} : { slots }),
    };
  };

  const bindSlots = (slots: BlockNode["slots"]): BlockNode["slots"] => {
    if (!isPlainRecord(slots)) return slots;
    let changed = false;
    const next: Record<string, BlockNode[]> = {};
    for (const name of ownKeys(slots)) {
      const children = ownEntry(slots, name);
      if (!Array.isArray(children)) {
        if (children !== undefined) defineEntry(next, name, children);
        continue;
      }
      const rebound = bindNodes(children);
      if (rebound !== children) changed = true;
      defineEntry(next, name, rebound);
    }
    return changed ? next : slots;
  };

  const nodes = bindNodes(document.nodes);
  return {
    document: nodes === document.nodes ? document : { ...document, nodes },
    bound,
    issues,
  };
}

/**
 * The top-level fields a set of documents binds, per source, so each source
 * is read once with exactly the fields its bindings need.
 *
 * A path's first segment is the field the source is read for; a relation or a
 * group it walks into is part of that field's value. List items are not
 * listed: the list reads them.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingDemand {
  /**
   * Whether any node holds a binding at all, of any source or shape. A page
   * whose only bindings read list items still needs the binding pass.
   */
  readonly any: boolean;
  /** The entry's fields, or `undefined` when nothing binds the entry. */
  readonly entry?: readonly string[];
  /** Each Single's fields, by slug. */
  readonly singles: ReadonlyMap<string, readonly string[]>;
  /** Whether anything binds the site settings. */
  readonly site: boolean;
}

/**
 * What the given documents' page bindings read.
 *
 * Only well-formed paths are listed, so a malformed binding cannot shape a
 * read; it falls back when the pass meets it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindingDemand(
  documents: Iterable<BlockDocument>
): BindingDemand {
  const demand: DemandSoFar = {
    any: false,
    entry: undefined,
    singles: new Map<string, Set<string>>(),
    site: false,
  };
  for (const document of documents) {
    if (isPlainRecord(document)) visitNodes(document.nodes, demand);
  }
  return {
    any: demand.any,
    ...(demand.entry === undefined ? {} : { entry: [...demand.entry] }),
    singles: new Map(
      [...demand.singles].map(([key, fields]) => [key, [...fields]] as const)
    ),
    site: demand.site,
  };
}

/** What the documents walked so far bind. */
interface DemandSoFar {
  any: boolean;
  entry: Set<string> | undefined;
  readonly singles: Map<string, Set<string>>;
  site: boolean;
}

/** The field a binding's source is read for, when its path is well formed. */
function firstField(
  binding: Readonly<Record<string, unknown>>
): string | undefined {
  const path = ownEntry(binding, "$bind");
  if (!isBindPath(path)) return undefined;
  const field = path.split(".")[0];
  // Never a field of any source, and a read naming it is refused whole.
  return field === "__proto__" ? undefined : field;
}

/** Add one binding's source and field to the demand. */
function visitBinding(binding: unknown, demand: DemandSoFar): void {
  if (!isPlainRecord(binding)) return;
  const field = firstField(binding);
  if (field === undefined) return;
  const source = ownEntry(binding, "source") ?? DEFAULT_BINDING_SOURCE;
  if (source === "entry") {
    demand.entry = (demand.entry ?? new Set<string>()).add(field);
    return;
  }
  if (source === "site") {
    demand.site = true;
    return;
  }
  if (source === "single") addSingleField(binding, field, demand);
}

/** A Single's field, under the slug the binding names. */
function addSingleField(
  binding: Readonly<Record<string, unknown>>,
  field: string,
  demand: DemandSoFar
): void {
  const key = ownEntry(binding, "sourceKey");
  if (typeof key !== "string" || key === "") return;
  demand.singles.set(key, (demand.singles.get(key) ?? new Set()).add(field));
}

/** Add every binding in one node, then in each of its stored slots. */
function visitNode(node: unknown, demand: DemandSoFar): void {
  if (!isPlainRecord(node)) return;
  const bindings = node.bindings;
  if (bindings !== undefined) demand.any = true;
  if (isPlainRecord(bindings)) {
    for (const prop of ownKeys(bindings)) {
      visitBinding(ownEntry(bindings, prop), demand);
    }
  }
  const slots = node.slots;
  if (!isPlainRecord(slots)) return;
  for (const name of ownKeys(slots)) visitNodes(ownEntry(slots, name), demand);
}

function visitNodes(nodes: unknown, demand: DemandSoFar): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes as unknown[]) visitNode(node, demand);
}
