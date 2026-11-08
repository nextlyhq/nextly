/**
 * A document's bindings judged against the schema of what they read, as a
 * save judges them.
 *
 * The same `checkBinding` the renderer runs before it resolves a binding, and
 * for the document's own metadata the same `checkSeoBinding`, so what a save
 * refuses and what a page falls back on are one rule. Judged over the whole
 * document at once, as a document's lists and visibility conditions
 * are, so a problem a stored form already held on the same block stays a
 * warning (`held-findings`): a page whose binding a schema change broke (a
 * field renamed, a prop's type changed) is still saved, and keeps the binding,
 * which renders its fallback, rather than becoming unsavable for a change
 * nobody made to it.
 *
 * @module binding-schema-issues
 */
import type { BindingIssue, BindingIssueCode } from "./binding-issues";
import {
  bindingSourceRef,
  checkBinding,
  type BindingCheck,
  type BindingSchemaRef,
  type BindingSchemaSource,
  type CheckedBinding,
} from "./binding-rules";
import type { PropSchema } from "./block";
import { DEFAULT_BINDING_SOURCE, MAX_SEO_SEGMENTS } from "./document";
import { withHeldSeverityOf } from "./held-findings";
import { pointer } from "./issue-text";
import {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  listItemRef,
  readListQuery,
} from "./list-query";
import type { NamedQuerySource } from "./named-query";
import { isPlainRecord } from "./plain-record";
import { ownEntry, ownKeys } from "./safe-record";
import { checkSeoBinding, type SeoBindingPlace } from "./seo-binding-check";
import type { SlotDefaultSource } from "./tree";

/**
 * What a document's bindings sit in: its blocks, and its own metadata under
 * `settings.seo`.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingDocument {
  readonly nodes: readonly unknown[];
  readonly settings?: unknown;
}

/**
 * What {@link bindingSchemaIssues} judges a forest against.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingSchemaJudgement {
  /** The fields each source has, as declared. */
  readonly schema: BindingSchemaSource;
  /** Whose fields the page's entry has. */
  readonly entry?: BindingSchemaRef;
  /** The blocks' declared props; absent, props are not judged. */
  readonly definitions?: SlotDefaultSource;
  /** The document's stored forms, whose held problems stay warnings. */
  readonly stored?: readonly unknown[];
  /** The most nodes judged, as the validator's survey caps them. */
  readonly maxNodes?: number;
  /**
   * The site's named queries, so a list over one binds its items as the
   * query's rows are declared: a collection's entries, or fields of their own.
   */
  readonly namedQueries?: NamedQuerySource;
}

/** One binding problem, where it sits and on which block. */
interface BindingFinding {
  readonly path: string;
  /** The block, or empty for the document's own metadata. */
  readonly nodeId: string;
  readonly code: BindingIssueCode;
  readonly message: string;
  /**
   * The prop and the binding as stored: the same problem wherever it is
   * placed, and another one once the binding is changed in any way.
   */
  readonly identity: string;
}

/**
 * A value as text with every object's keys in order, so the same value reads
 * the same however it was stored: PostgreSQL's `jsonb` keeps keys in an order
 * of its own.
 */
function canonicalText(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalText(item)).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${ownKeys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalText(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The binding as stored, its source spelled out: the same binding however it
 * was written, and another one once anything it reads or falls back to
 * changes, so only an unchanged break is held.
 */
function bindingIdentity(binding: unknown): string {
  if (!isPlainRecord(binding)) return "";
  return canonicalText({
    ...binding,
    source: ownEntry(binding, "source") ?? DEFAULT_BINDING_SOURCE,
  });
}

/**
 * The props a link's entry reference is stored in: the names the renderer's
 * `linkFor` and the inspector's link group read, the collection the entry is
 * of and its id.
 */
const ENTRY_LINK = { collection: "entryCollection", id: "entryId" } as const;

/** A node's bound props' problems, against the judgement's schema. */
function nodeFindings(
  node: Readonly<Record<string, unknown>>,
  path: string,
  judgement: BindingSchemaJudgement,
  item: BindingSchemaRef | undefined
): BindingFinding[] {
  const bindings = node.bindings;
  const id = node.id;
  if (!isPlainRecord(bindings) || typeof id !== "string") return [];
  const props = declaredProps(node.type, judgement.definitions);
  const findings: BindingFinding[] = [];
  for (const prop of ownKeys(bindings)) {
    const bound = { id, prop, binding: ownEntry(bindings, prop), props };
    const at = pointer(pointer(path, "bindings"), prop);
    const check = bindingCheckOf(bound, judgement, item);
    findings.push(...propFindings(bound, at, check));
    if (prop === ENTRY_LINK.id) {
      findings.push(
        ...entryLinkFindings(
          { node, bindings, bound, check },
          at,
          judgement,
          item
        )
      );
    }
  }
  return findings;
}

/**
 * The collection a bound entry id names entries of: the one collection the
 * relation its path crosses points at, where the path reads that related
 * entry's `id` (`author.id`). `undefined` for any other path, or a relation
 * whose target is not one collection, which the path's own check judges.
 */
function relatedEntryCollection(
  binding: CheckedBinding,
  judgement: BindingSchemaJudgement,
  item: BindingSchemaRef | undefined
): string | undefined {
  const [relation, read, ...rest] = binding.segments;
  if (relation === undefined || read !== "id" || rest.length > 0) {
    return undefined;
  }
  const ref = bindingSourceRef(binding, schemaOf(judgement, item).refs);
  const field =
    ref === undefined
      ? undefined
      : judgement.schema.fieldsOf(ref)?.find(each => each.name === relation);
  return field?.hasMany !== true && typeof field?.relationTo === "string"
    ? field.relationTo
    : undefined;
}

/**
 * A link whose entry id is bound to a related entry's id, refused where its
 * stored Linked collection is not the collection that relation points at:
 * the link would look the entry up in the wrong collection and draw no link,
 * silently. Judged only when the binding itself passed its check, and only
 * against a Linked collection stored as a value: one bound too is read per
 * page and cannot be judged here.
 */
function entryLinkFindings(
  link: {
    readonly node: Readonly<Record<string, unknown>>;
    readonly bindings: Readonly<Record<string, unknown>>;
    readonly bound: BoundProp;
    readonly check: BindingCheck;
  },
  path: string,
  judgement: BindingSchemaJudgement,
  item: BindingSchemaRef | undefined
): BindingFinding[] {
  const { node, bindings, bound, check } = link;
  if (check.outcome !== "resolve") return [];
  if (bound.props !== undefined && !(ENTRY_LINK.collection in bound.props)) {
    return [];
  }
  if (ownEntry(bindings, ENTRY_LINK.collection) !== undefined) return [];
  const target = relatedEntryCollection(check.binding, judgement, item);
  if (target === undefined) return [];
  const props = node.props;
  const stored = isPlainRecord(props)
    ? ownEntry(props, ENTRY_LINK.collection)
    : undefined;
  if (stored === target) return [];
  const relation = check.binding.segments[0] ?? "";
  return [
    {
      path,
      nodeId: bound.id,
      code: "binding-entry-collection-mismatch",
      message:
        typeof stored === "string" && stored !== ""
          ? `Linked collection is "${stored}", but "${relation}" points at entries of "${target}". Set Linked collection to "${target}".`
          : `Linked collection is not set, and "${relation}" points at entries of "${target}". Set Linked collection to "${target}".`,
      // The binding and the collection it is judged with: a stored mismatch
      // stays held only while neither changes.
      identity: `${bound.prop}\u0000${bindingIdentity(bound.binding)}\u0000${canonicalText(stored)}`,
    },
  ];
}

/**
 * The props a block declares, or `undefined` when its definition is not
 * found. A definition found with no `props` declares none, so every binding
 * on it names a prop it lacks; only a definition not found leaves props
 * unjudged.
 */
function declaredProps(
  type: unknown,
  definitions: SlotDefaultSource | undefined
): Partial<Record<string, PropSchema>> | undefined {
  const definition =
    typeof type === "string" ? definitions?.get(type) : undefined;
  return definition === undefined ? undefined : (definition.props ?? {});
}

/**
 * The schema and the refs a check of one binding is given: the entry's, and
 * the item's of the list the binding is drawn in, when there is one.
 */
function schemaOf(
  judgement: BindingSchemaJudgement,
  item?: BindingSchemaRef
): {
  readonly schema: BindingSchemaSource;
  readonly refs?: {
    readonly entry?: BindingSchemaRef;
    readonly item?: BindingSchemaRef;
  };
} {
  const refs = {
    ...(judgement.entry === undefined ? {} : { entry: judgement.entry }),
    ...(item === undefined ? {} : { item }),
  };
  return {
    schema: judgement.schema,
    ...(Object.keys(refs).length === 0 ? {} : { refs }),
  };
}

/** One binding's check, as findings at `path` on block `nodeId`. */
function findingsOf(
  issues: readonly BindingIssue[],
  path: string,
  nodeId: string,
  identity: string
): BindingFinding[] {
  return (
    issues
      // A malformed binding is the shape check's to report, once.
      .filter(issue => issue.code !== "binding-malformed")
      .map(issue => ({
        path,
        nodeId,
        code: issue.code,
        message: issue.message,
        identity,
      }))
  );
}

/** One bound prop of a block, as stored, with the props the block declares. */
interface BoundProp {
  readonly id: string;
  readonly prop: string;
  readonly binding: unknown;
  readonly props: Partial<Record<string, PropSchema>> | undefined;
}

/** One bound prop's check against the judgement's schema. */
function bindingCheckOf(
  bound: BoundProp,
  judgement: BindingSchemaJudgement,
  item: BindingSchemaRef | undefined
): BindingCheck {
  return checkBinding({
    nodeId: bound.id,
    prop: bound.prop,
    binding: bound.binding,
    ...(bound.props === undefined ? {} : { props: bound.props }),
    ...schemaOf(judgement, item),
  });
}

/** One bound prop's problems, where it sits. */
function propFindings(
  bound: BoundProp,
  path: string,
  check: BindingCheck
): BindingFinding[] {
  return findingsOf(
    check.issues,
    path,
    bound.id,
    `${bound.prop}\u0000${bindingIdentity(bound.binding)}`
  );
}

/**
 * A list of nodes still being walked: its nodes, the next one to visit, and
 * the path each sits at. Read one node at a time, so a list of any width
 * costs nothing past the nodes judged.
 */
interface Frame {
  readonly nodes: readonly unknown[];
  next: number;
  readonly at: (index: number) => string;
  /** The item its nodes are drawn with: the nearest list's, if any. */
  readonly item: BindingSchemaRef | undefined;
}

/**
 * The item a node's slot draws its children with: a list's entries slot draws
 * each of its entries ({@link listItemRef}), its other slots (the empty state)
 * none; any other node's slots draw the item it is drawn with.
 */
function slotItem(
  node: Readonly<Record<string, unknown>>,
  slot: string,
  item: BindingSchemaRef | undefined,
  namedQueries: NamedQuerySource | undefined
): BindingSchemaRef | undefined {
  if (node.type !== COLLECTION_LIST_TYPE) return item;
  if (slot !== LIST_ENTRY_SLOT) return undefined;
  const { query } = readListQuery(node.props);
  const name = query.namedQuery?.name;
  // A named query's rows that are a collection's entries bind as that
  // collection's, as the render draws them.
  const rows =
    name === undefined ? undefined : namedQueries?.declarationOf(name)?.rows;
  return listItemRef({
    collection:
      query.collection ??
      (rows !== undefined && "collection" in rows
        ? rows.collection
        : undefined),
    query: name,
  });
}

/**
 * A node's slots, as lists to walk, the last slot first: the stack pops the
 * first slot first, so the walk keeps document order.
 */
function slotFrames(
  node: Readonly<Record<string, unknown>>,
  path: string,
  item: BindingSchemaRef | undefined,
  namedQueries: NamedQuerySource | undefined
): Frame[] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  const frames: Frame[] = [];
  for (const name of Object.keys(slots).reverse()) {
    const children = slots[name];
    if (!Array.isArray(children)) continue;
    const slotPath = pointer(`${path}/slots`, name);
    frames.push({
      nodes: children,
      next: 0,
      at: index => pointer(slotPath, index),
      item: slotItem(node, name, item, namedQueries),
    });
  }
  return frames;
}

/**
 * Every binding problem in a forest, in document order. Iterative, so no depth
 * exhausts the stack, and capped at `maxNodes` as the validator's survey is:
 * no node past the cap is visited, nor any list read past it.
 */
function walkBindingFindings(
  nodes: readonly unknown[],
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  const findings: BindingFinding[] = [];
  let left = judgement.maxNodes ?? Number.MAX_SAFE_INTEGER;
  const stack: Frame[] = [
    { nodes, next: 0, at: index => pointer("/nodes", index), item: undefined },
  ];
  while (left > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    if (frame.next >= frame.nodes.length) {
      stack.pop();
      continue;
    }
    const index = frame.next;
    frame.next += 1;
    left -= 1;
    const node: unknown = frame.nodes[index];
    if (!isPlainRecord(node)) continue;
    const path = frame.at(index);
    findings.push(...nodeFindings(node, path, judgement, frame.item));
    for (const slot of slotFrames(
      node,
      path,
      frame.item,
      judgement.namedQueries
    ))
      stack.push(slot);
  }
  return findings;
}

/** One metadata binding's problems, where it sits. */
function seoBindingFindings(
  binding: unknown,
  path: string,
  place: SeoBindingPlace,
  field: string,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  // A list item is no source for the metadata; the shape check refuses it.
  if (isPlainRecord(binding) && ownEntry(binding, "source") === "item") {
    return [];
  }
  const check = checkSeoBinding({
    binding,
    place,
    id: path,
    ...schemaOf(judgement),
  });
  return findingsOf(
    check.issues,
    path,
    "",
    `seo:${field}\u0000${bindingIdentity(binding)}`
  );
}

/**
 * The problems of a document's own metadata bindings: each binding among the
 * title's and the description's pieces, and the social image.
 */
function seoFindings(
  settings: unknown,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  if (!isPlainRecord(settings)) return [];
  const seo = ownEntry(settings, "seo");
  if (!isPlainRecord(seo)) return [];
  const at = "/settings/seo";
  const findings: BindingFinding[] = [];
  for (const field of ["title", "description"] as const) {
    const pieces = ownEntry(seo, field);
    if (!Array.isArray(pieces)) continue;
    // No more pieces than a value may hold; the shape check refuses the rest.
    pieces.slice(0, MAX_SEO_SEGMENTS).forEach((piece: unknown, index) => {
      if (typeof piece === "string") return;
      findings.push(
        ...seoBindingFindings(
          piece,
          pointer(pointer(at, field), String(index)),
          "text",
          field,
          judgement
        )
      );
    });
  }
  const image = ownEntry(seo, "image");
  if (image !== undefined) {
    findings.push(
      ...seoBindingFindings(
        image,
        pointer(at, "image"),
        "image",
        "image",
        judgement
      )
    );
  }
  return findings;
}

/** Every binding problem in a document: its blocks', then its metadata's. */
function documentFindings(
  document: BindingDocument,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  return [
    ...walkBindingFindings(document.nodes, judgement),
    ...seoFindings(document.settings, judgement),
  ];
}

/** A stored form as the document it judges, or nothing for one unreadable. */
function storedDocument(
  form: Readonly<Record<string, unknown>>
): BindingDocument | undefined {
  return Array.isArray(form.nodes)
    ? { nodes: form.nodes, settings: form.settings }
    : undefined;
}

/**
 * A document's bindings judged against the schema: a prop the block does not
 * have, a field the source does not have, a type that does not fit, a format
 * the field or prop cannot take, and a fallback that is not a valid value of
 * the prop, on its blocks and in its own metadata. Each is an error, except
 * one a stored form already held on the same block (or in the same metadata
 * field), reading the same source, which is a warning.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindingSchemaIssues(
  document: BindingDocument,
  judgement: BindingSchemaJudgement
): {
  readonly path: string;
  /** The block the issue is about, or empty for the document's metadata. */
  readonly nodeId: string;
  readonly code: BindingIssueCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}[] {
  return withHeldSeverityOf(
    documentFindings(document, judgement),
    judgement.stored,
    form => documentFindings(form, judgement),
    storedDocument
  );
}
