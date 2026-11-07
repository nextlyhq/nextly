/**
 * A document's bindings judged against the schema of what they read, as a
 * save judges them.
 *
 * The same `checkBinding` the renderer runs before it resolves a binding, so
 * what a save refuses and what a page falls back on are one rule. Judged over
 * the whole forest at once, as a document's lists and visibility conditions
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
import { withHeldSeverity } from "./held-findings";
import { pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
import { ownEntry, ownKeys } from "./safe-record";
import type { SlotDefaultSource } from "./tree";

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
  readonly nodeId: string;
  readonly code: BindingIssueCode;
  readonly message: string;
  /** The prop and the stored path: the same problem wherever it is placed. */
  readonly identity: string;
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
    const check = checkBinding({
      nodeId: id,
      prop,
      binding: ownEntry(bindings, prop),
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
        identity: `${prop}\u0000${issue.path}`,
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

/**
 * A forest's bindings judged against the schema: a prop the block does not
 * have, a field the source does not have, a type that does not fit, a format
 * the field or prop cannot take, and a fallback that is not a valid value of
 * the prop. Each is an error, except one a stored form already held on the
 * same block, which is a warning.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindingSchemaIssues(
  nodes: readonly unknown[],
  judgement: BindingSchemaJudgement
): {
  readonly path: string;
  /** The block the issue is about. */
  readonly nodeId: string;
  readonly code: BindingIssueCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}[] {
  return withHeldSeverity(
    walkBindingFindings(nodes, judgement),
    judgement.stored,
    forest => walkBindingFindings(forest, judgement)
  );
}
