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
import type { BindingIssueCode } from "./binding-issues";
import {
  checkBinding,
  type BindingSchemaRef,
  type BindingSchemaSource,
} from "./binding-rules";
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
   * The prop, the source and the stored path: the same problem wherever it is
   * placed, and another one once the binding reads another source.
   */
  readonly identity: string;
}

/** What a binding reads: its source, and the Single it names. */
function sourceIdentity(binding: unknown): string {
  if (!isPlainRecord(binding)) return "";
  const source = ownEntry(binding, "source") ?? DEFAULT_BINDING_SOURCE;
  const key = ownEntry(binding, "sourceKey");
  return `${typeof source === "string" ? source : ""}\u0000${typeof key === "string" ? key : ""}`;
}

/** A node still to judge, and where it sits. */
interface Visit {
  readonly node: unknown;
  readonly path: string;
}

/** A node's bound props' problems, against the judgement's schema. */
function nodeFindings(
  node: Readonly<Record<string, unknown>>,
  path: string,
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  const bindings = node.bindings;
  const id = node.id;
  const type = node.type;
  if (!isPlainRecord(bindings) || typeof id !== "string") return [];
  // A definition found with no `props` declares none, so every binding on it
  // names a prop it lacks; only a definition not found leaves props unjudged.
  const definition =
    typeof type === "string" ? judgement.definitions?.get(type) : undefined;
  const props = definition === undefined ? undefined : (definition.props ?? {});
  const findings: BindingFinding[] = [];
  for (const prop of ownKeys(bindings)) {
    const binding = ownEntry(bindings, prop);
    const check = checkBinding({
      nodeId: id,
      prop,
      binding,
      ...(props === undefined ? {} : { props }),
      schema: judgement.schema,
      ...(judgement.entry === undefined
        ? {}
        : { refs: { entry: judgement.entry } }),
    });
    for (const issue of check.issues) {
      // A malformed binding is the shape check's to report, once.
      if (issue.code === "binding-malformed") continue;
      findings.push({
        path: pointer(pointer(path, "bindings"), prop),
        nodeId: id,
        code: issue.code,
        message: issue.message,
        identity: `${prop}\u0000${sourceIdentity(binding)}\u0000${issue.path}`,
      });
    }
  }
  return findings;
}

/** A node's children to judge, in document order once popped. */
function childVisits(
  node: Readonly<Record<string, unknown>>,
  path: string
): Visit[] {
  const slots = node.slots;
  if (!isPlainRecord(slots)) return [];
  const visits: Visit[] = [];
  for (const name of Object.keys(slots).reverse()) {
    const children = slots[name];
    if (!Array.isArray(children)) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      visits.push({
        node: children[index],
        path: pointer(pointer(`${path}/slots`, name), index),
      });
    }
  }
  return visits;
}

/**
 * Every binding problem in a forest, in document order. Iterative, so no depth
 * exhausts the stack, and capped at `maxNodes` as the validator's survey is.
 */
function walkBindingFindings(
  nodes: readonly unknown[],
  judgement: BindingSchemaJudgement
): BindingFinding[] {
  const findings: BindingFinding[] = [];
  let left = judgement.maxNodes ?? Number.MAX_SAFE_INTEGER;
  const stack: Visit[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: nodes[index], path: pointer("/nodes", index) });
  }
  for (
    let visit = stack.pop();
    visit !== undefined && left > 0;
    visit = stack.pop()
  ) {
    left -= 1;
    const { node, path } = visit;
    if (!isPlainRecord(node)) continue;
    findings.push(...nodeFindings(node, path, judgement));
    stack.push(...childVisits(node, path));
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
    schema: judgement.schema,
    ...(judgement.entry === undefined
      ? {}
      : { refs: { entry: judgement.entry } }),
  });
  return check.issues
    .filter(issue => issue.code !== "binding-malformed")
    .map(issue => ({
      path,
      nodeId: "",
      code: issue.code,
      message: issue.message,
      identity: `seo:${field}\u0000${sourceIdentity(binding)}\u0000${issue.path}`,
    }));
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
