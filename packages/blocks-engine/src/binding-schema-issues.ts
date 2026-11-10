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
  checkBinding,
  type BindingSchemaRef,
  type BindingSchemaSource,
} from "./binding-rules";
import type { PropSchema } from "./block";
import { DEFAULT_BINDING_SOURCE, MAX_SEO_SEGMENTS } from "./document";
import { withHeldSeverityOf } from "./held-findings";
import { pointer } from "./issue-text";
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

/** A node's bound props' problems, against the judgement's schema. */
function nodeFindings(
  node: Readonly<Record<string, unknown>>,
  path: string,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  const bindings = node.bindings;
  const id = node.id;
  if (!isPlainRecord(bindings) || typeof id !== "string") return [];
  const props = declaredProps(node.type, judgement.definitions);
  const findings: BindingFinding[] = [];
  for (const prop of ownKeys(bindings)) {
    findings.push(
      ...propFindings(
        { id, prop, binding: ownEntry(bindings, prop), props },
        pointer(pointer(path, "bindings"), prop),
        judgement
      )
    );
  }
  return findings;
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

/** The schema and the entry's ref a check of one binding is given. */
function schemaOf(judgement: BindingSchemaJudgement): {
  readonly schema: BindingSchemaSource;
  readonly refs?: { readonly entry: BindingSchemaRef };
} {
  return {
    schema: judgement.schema,
    ...(judgement.entry === undefined
      ? {}
      : { refs: { entry: judgement.entry } }),
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

/** One bound prop's problems, where it sits. */
function propFindings(
  bound: {
    readonly id: string;
    readonly prop: string;
    readonly binding: unknown;
    readonly props: Partial<Record<string, PropSchema>> | undefined;
  },
  path: string,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  const check = checkBinding({
    nodeId: bound.id,
    prop: bound.prop,
    binding: bound.binding,
    ...(bound.props === undefined ? {} : { props: bound.props }),
    ...schemaOf(judgement),
  });
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
}

/**
 * A node's slots, as lists to walk, the last slot first: the stack pops the
 * first slot first, so the walk keeps document order.
 */
function slotFrames(
  node: Readonly<Record<string, unknown>>,
  path: string
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
    { nodes, next: 0, at: index => pointer("/nodes", index) },
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
    findings.push(...nodeFindings(node, path, judgement));
    for (const slot of slotFrames(node, path)) stack.push(slot);
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
