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
 * @experimental Settles with the editor's binding controls.
 */
export function bindOp(
  document: BlockDocument,
  id: string,
  prop: string,
  binding: Binding
): BuilderOp | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  return {
    kind: "update",
    id,
    patch: { bindings: { ...bindingsOf(node), [prop]: binding } },
  };
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
