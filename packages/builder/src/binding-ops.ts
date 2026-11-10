/**
 * The ops that bind a block's prop to a field and unbind it, for the
 * inspector's binding controls and the page actions API alike, so both write
 * a binding the one way.
 *
 * Neither decides whether the binding fits: the write is judged as any save
 * is, against the schema of what it reads. An unbind writes what the caller
 * resolved to keep (on the server, as a visitor sees it): the prop's value,
 * or for an image a visitor saw by its address, that address in the block's
 * declared address prop, the media prop then emptied.
 *
 * @module binding-ops
 */
import {
  findNode,
  isPlainRecord,
  type Binding,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/** A node's bindings, as a fresh record; none when it has none. */
function bindingsOf(node: {
  readonly bindings?: Readonly<Record<string, Binding>>;
}): Record<string, Binding> {
  return node.bindings === undefined ? {} : { ...node.bindings };
}

/**
 * The op binding `prop` of block `id` to `binding`, replacing a binding the
 * prop already had; `null` when the document holds no such block.
 *
 * `clear` names props emptied in the same op, for a prop another prop would
 * win over once bound: a button's entry reference is followed before its
 * address, so binding the address alone would leave the button going to the
 * entry. Only props the block holds are named in the patch, so a bind with
 * nothing to clear writes the bindings alone.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function bindOp(
  document: BlockDocument,
  id: string,
  prop: string,
  binding: Binding,
  clear: readonly string[] = [],
  more: {
    /**
     * Props set in the same edit: what the bound value needs beside it,
     * such as the collection of the entry a link's bound id names.
     */
    readonly set?: Readonly<Record<string, unknown>>;
    /**
     * Other props' bindings removed in the same edit: one the block would
     * follow before this one, such as a link's address bound before the
     * entry it now points at.
     */
    readonly unbind?: readonly string[];
  } = {}
): BuilderOp | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  const kept = Object.entries(bindingsOf(node)).filter(
    ([name]) => name === prop || !(more.unbind ?? []).includes(name)
  );
  const bindings = { ...Object.fromEntries(kept), [prop]: binding };
  const props: Record<string, unknown> = isPlainRecord(node.props)
    ? { ...node.props }
    : {};
  const held = clear.filter(name => Object.hasOwn(props, name));
  const setting = Object.entries(more.set ?? {});
  if (held.length === 0 && setting.length === 0) {
    return { kind: "update", id, patch: { bindings } };
  }
  for (const name of held) delete props[name];
  for (const [name, value] of setting) {
    // Defined rather than assigned, so a prop's name can't reach the
    // prototype.
    Object.defineProperty(props, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { kind: "update", id, patch: { bindings, props } };
}

/**
 * What an unbind keeps in the block's props: values to set, and props to
 * empty. For an image a visitor saw by its address, the address is set on
 * the declared address prop and the media prop emptied.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface KeptProps {
  readonly set: Readonly<Record<string, unknown>>;
  readonly empty?: readonly string[];
}

/**
 * The op unbinding `prop` of block `id`, keeping `kept` in its props; `null`
 * when the document holds no such block. A block left with no binding stores
 * none.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function unbindOp(
  document: BlockDocument,
  id: string,
  prop: string,
  kept: KeptProps
): BuilderOp | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  const bindings = bindingsOf(node);
  delete bindings[prop];
  const props: Record<string, unknown> = {
    ...(isPlainRecord(node.props) ? node.props : {}),
    ...kept.set,
  };
  for (const name of kept.empty ?? []) delete props[name];
  return Object.keys(bindings).length === 0
    ? { kind: "update", id, patch: { props }, unset: ["bindings"] }
    : { kind: "update", id, patch: { props, bindings } };
}
