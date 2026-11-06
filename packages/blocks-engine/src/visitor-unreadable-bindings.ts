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
 * A source the public may read none of is not in those shapes at all, so its
 * bindings are judged whole: the host says which sources the person editing
 * reads that the public may not (`unreadableSource`), and every binding to
 * one is marked.
 *
 * Only the page's entry and its Singles are judged. The site settings are
 * read through their own public allowlist, the same for everyone, and a list
 * item's bindings are judged by the list's rows, not here.
 *
 * @module visitor-unreadable-bindings
 */
import {
  checkBinding,
  type BindingCheck,
  type BindingSchemaRef,
  type BindingSchemaSource,
  type CheckedBinding,
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
  /**
   * Whether a source exists for the person editing but the public may read
   * none of it: the published page reads nothing of it and every binding to
   * it falls back. Absent, no source is judged whole.
   */
  readonly unreadableSource?: (ref: BindingSchemaRef) => boolean;
}

/** The schema ref a checked binding's source is read under, when judged here. */
function sourceRefOf(
  binding: CheckedBinding,
  entryRef: BindingSchemaRef | undefined
): BindingSchemaRef | undefined {
  if (binding.source === "entry") return entryRef;
  if (binding.source === "single" && binding.sourceKey !== undefined) {
    return { single: binding.sourceKey };
  }
  return undefined;
}

/** A binding the page would fill, whose whole source the public may not read. */
function unreadableWhole(
  check: BindingCheck,
  prop: string,
  input: VisitorUnreadableInput
): VisitorUnreadableBinding | undefined {
  if (check.outcome !== "resolve" || input.unreadableSource === undefined) {
    return undefined;
  }
  const { binding } = check;
  const ref = sourceRefOf(binding, input.entryRef);
  if (ref === undefined || !input.unreadableSource(ref)) return undefined;
  return {
    prop,
    path: binding.path,
    ...(binding.fallback === undefined ? {} : { fallback: binding.fallback }),
  };
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
    const whole = unreadableWhole(check, prop, input);
    if (whole !== undefined) {
      marked.push(whole);
      continue;
    }
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
