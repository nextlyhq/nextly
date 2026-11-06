/**
 * The bound props a visitor will not see: bindings whose field the public may
 * not read, so the published page shows their fallback instead.
 *
 * An editor reads its page's sources as the person editing, who may read
 * fields a visitor may not. Whether the published page can fill a binding is
 * decided by `checkBinding` against the field shapes a visitor may read: a
 * path naming a field those shapes do not list is `binding-field-missing`,
 * and the page falls back. This asks that same check, with the same public
 * shapes, so what the editor marks and what a visitor is served are one rule.
 *
 * Only the page's entry and its Singles are judged. The site settings are
 * read through their own public allowlist, the same for everyone, and a list
 * item's bindings are judged by the list's rows, not here.
 *
 * @module visitor-unreadable-bindings
 */
import {
  checkBinding,
  type BindingSchemaRef,
  type BindingSchemaSource,
} from "./binding-rules";
import type { BlockDocument } from "./document";
import { walkForest } from "./forest-walk";
import { isPlainRecord } from "./plain-record";
import type { BlockPropsLookup } from "./resolve-bindings";
import { ownEntry, ownKeys } from "./safe-record";

/**
 * One bound prop a visitor will not see filled.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface VisitorUnreadableBinding {
  /** The prop the binding fills. */
  readonly prop: string;
  /** The binding's stored path, such as `internalNote` or `author.email`. */
  readonly path: string;
  /**
   * What a visitor sees instead, when the binding stores a fallback that is a
   * valid value of the prop. Absent, a visitor sees the prop's own value.
   */
  readonly fallback?: { readonly value: unknown };
}

/**
 * What {@link visitorUnreadableBindings} judges a document against.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface VisitorUnreadableInput {
  /** The field shapes a visitor may read, as the published page reads them. */
  readonly schema: BindingSchemaSource;
  /** Whose fields the page's entry has. */
  readonly entryRef?: BindingSchemaRef;
  /** The blocks' declared props, so a fallback is judged as the page judges it. */
  readonly props?: BlockPropsLookup;
}

/** The shapes judged here: the site settings never are. */
function entryAndSingles(schema: BindingSchemaSource): BindingSchemaSource {
  return {
    fieldsOf: ref => ("site" in ref ? undefined : schema.fieldsOf(ref)),
  };
}

/** One node's bindings a visitor will not see filled; none when it holds none. */
function unreadableOn(
  node: Readonly<Record<string, unknown>>,
  input: VisitorUnreadableInput,
  schema: BindingSchemaSource
): { readonly id: string; readonly marked: VisitorUnreadableBinding[] } | null {
  const bindings: unknown = node.bindings;
  const id: unknown = node.id;
  if (!isPlainRecord(bindings) || typeof id !== "string") return null;
  const type: unknown = node.type;
  const definition =
    typeof type === "string" ? input.props?.get(type) : undefined;
  const refs = input.entryRef === undefined ? {} : { entry: input.entryRef };
  const marked: VisitorUnreadableBinding[] = [];
  for (const prop of ownKeys(bindings)) {
    const check = checkBinding({
      nodeId: id,
      prop,
      binding: ownEntry(bindings, prop),
      // A definition found with no props declares none, as the page reads it.
      ...(definition === undefined ? {} : { props: definition.props ?? {} }),
      schema,
      refs,
    });
    if (check.outcome !== "fallback") continue;
    const missing = check.issues.find(
      issue => issue.code === "binding-field-missing"
    );
    if (missing === undefined) continue;
    marked.push({
      prop,
      path: missing.path,
      ...(check.fallback === undefined ? {} : { fallback: check.fallback }),
    });
  }
  return marked.length === 0 ? null : { id, marked };
}

/**
 * The bindings a visitor will not see filled, by the id of the node holding
 * them. A node with none is not listed.
 *
 * Total: a node or a binding of any shape gives an answer, never a throw. A
 * source whose shapes are not known is not judged, so nothing is marked on a
 * guess.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function visitorUnreadableBindings(
  document: BlockDocument,
  input: VisitorUnreadableInput
): ReadonlyMap<string, readonly VisitorUnreadableBinding[]> {
  const found = new Map<string, VisitorUnreadableBinding[]>();
  if (!isPlainRecord(document)) return found;
  const nodes: unknown = document.nodes;
  if (!Array.isArray(nodes)) return found;
  const schema = entryAndSingles(input.schema);
  walkForest(nodes, entry => {
    if (!isPlainRecord(entry.node)) return "skip";
    const on = unreadableOn(entry.node, input, schema);
    if (on !== null)
      found.set(on.id, [...(found.get(on.id) ?? []), ...on.marked]);
    return "descend";
  });
  return found;
}
