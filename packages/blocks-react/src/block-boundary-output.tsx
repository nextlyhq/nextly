/**
 * A block's output on its way to the page: checked and given the node's
 * attributes, an async block's output read once it settles, and the outputs
 * the editor keeps so drawing the page again doesn't run each async block
 * again.
 *
 * @module block-boundary-output
 */
import type { BlockNode, BoundValues } from "@nextlyhq/blocks-engine";
import { Suspense, use, type ReactNode } from "react";

import {
  type EditorIdentity,
  editorIdentityOf,
  placeholderEditor,
  withNodeAttributes,
} from "./block-boundary-attributes";
import {
  nodeRootReason,
  readRootShape,
  warnNoHostRoot,
} from "./block-boundary-root-checks";
import type { BlockHostPolicy, PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
import { describeThrown, normalizeRenderable } from "./renderable";

/**
 * Validates a block's output and substitutes a placeholder when it is unusable.
 *
 * A promise found inside the output gets a boundary here. React 19 renders a
 * promise child by suspending on it, and without one the suspension travels up
 * to whatever boundary sits above the whole page — so a single async child
 * inside an otherwise ordinary block would hold back everything around it.
 */
export function checkedOutput(
  value: unknown,
  node: BlockNode,
  fallback: ReactNode,
  // The node's root-level fields belong to the block's OWN root element. This
  // function is re-entered for each awaited child, and applying them again
  // there would put the node's id and attributes on a nested element while the
  // block's root, being a list, received none of them.
  isBlockRoot: boolean,
  /** What the block declared about these props, decided once by the caller. */
  declaresNothing: boolean,
  /** Whether the block's definition declares at least one slot, decided once by the caller. */
  declaresSlots: boolean,
  /** Whether the editor asked for a per-node DOM address. */
  nodeAttribute = false,
  /**
   * The editor address, snapshotted before the block rendered.
   *
   * Carried rather than re-derived here, because this function runs AFTER the
   * block — and, on the awaited path, after an `await` inside it.
   */
  identity: EditorIdentity = editorIdentityOf(node, nodeAttribute)
): ReactNode {
  const result = normalizeRenderable(value, {
    // A promise the block returned inside a list is awaited under the same
    // containment its own render gets, so a rejection becomes this block's
    // placeholder instead of an error React raises after the boundary has
    // already returned. Each gets its own boundary, so one slow child does not
    // hold back the siblings beside it.
    wrapOwnedThenable: (pending, index) => (
      <Suspense key={`nx-async-${index}`} fallback={fallback}>
        <AsyncBlockOutput
          pending={pending}
          node={node}
          fallback={fallback}
          isBlockRoot={false}
          declaresNothing={declaresNothing}
          declaresSlots={declaresSlots}
          identity={identity}
          nodeAttribute={nodeAttribute}
        />
      </Suspense>
    ),
  });

  if (!result.ok) {
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
        detail={`Expected a React node, received ${result.reason}`}
      />
    );
  }

  // Warned INDEPENDENTLY of whether the document asked for root fields: the
  // block is non-conforming either way, and waiting for someone to set an
  // anchor is what made a page author look responsible for it.
  /*
   * Classified ONCE, and both policies below read that value rather than the
   * output. They ask the same question of the same author-controlled object,
   * and asking twice is asking something that can answer differently — which
   * for the placeholder path meant an accessor throwing where nothing guarded
   * it. One reading, two policies.
   */
  const shape = isBlockRoot ? readRootShape(result.node) : null;
  if (shape === "unreadable") {
    /*
     * Refused rather than passed on. React reads the same accessors after this
     * returns, so output that cannot be classified here is output whose next
     * read is React's, past this boundary and past any containment — which is
     * exactly the failure `normalizeRenderable` exists to prevent.
     */
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
        detail="Expected a React node, received output whose own element type could not be read"
      />
    );
  }
  if (shape !== null) warnNoHostRoot(result.node, node, declaresNothing, shape);
  const rootReason =
    shape !== null
      ? nodeRootReason(result.node, node, declaresNothing, shape)
      : null;
  if (rootReason !== null) {
    return (
      <BlockPlaceholder
        reason="invalid-output"
        type={node.type}
        id={node.id}
        editor={placeholderEditor(nodeAttribute, identity)}
        detail={rootReason}
      />
    );
  }

  // Only promises inside borrowed JSX children reach here unwrapped, since
  // nothing can be substituted into an element that already exists. React
  // suspends on them, so they still need a boundary above.
  const withAttributes = isBlockRoot
    ? withNodeAttributes(
        result.node,
        node,
        nodeAttribute,
        declaresSlots,
        identity
      )
    : result.node;
  if (!result.hasUnwrappedThenable) return withAttributes;
  return <Suspense fallback={fallback}>{withAttributes}</Suspense>;
}

/** An async block's output once settled, either way, so reading it never throws a rejection. */
type SettledOutput =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

/**
 * One settled reading per promise, whichever render asks for it.
 *
 * React reads a promise with `use` and, while it is pending, renders again
 * once it settles; a promise made afresh by that render is a new one, so the
 * block would wait for ever. Keyed by the promise itself, so the same output
 * always answers with the same reading.
 */
const SETTLED = new WeakMap<object, Promise<SettledOutput>>();

function settledOf(pending: PromiseLike<unknown>): Promise<SettledOutput> {
  const known = SETTLED.get(pending);
  if (known !== undefined) return known;
  const settled = Promise.resolve(pending).then(
    (value): SettledOutput => ({ ok: true, value }),
    (error: unknown): SettledOutput => ({ ok: false, error })
  );
  SETTLED.set(pending, settled);
  return settled;
}

/**
 * The outputs of async blocks the EDITOR has drawn, per page context, so
 * drawing the page again does not run each one again.
 *
 * The editor renders in the browser, and renders the page again for a
 * selection or a panel opening. Run again, an async block makes a new promise,
 * and its boundary shows the fallback until that settles: an image or a
 * button blinks out. Kept by everything the output is made from: the block,
 * its class and the node as stored, so a change to any of them runs the block
 * again, and by the bound values beside the node's props, which the output
 * reads too. Per context, because the output also
 * reads the context (the entry, the language, a loop's item), and a block
 * under another context is another output.
 *
 * Never on a published page: a page served to visitors is rendered per
 * request, and an output kept across requests would serve one request's data
 * to the next.
 */
const EDITOR_OUTPUTS = new WeakMap<
  PageContext,
  Map<string, PromiseLike<unknown>>
>();

/** How many outputs a context keeps, the longest unused dropped first. */
const EDITOR_OUTPUTS_KEPT = 256;

/**
 * What an editor output is kept by, or `undefined` where it cannot be told.
 * Whether the draw carries the editor's markers is part of it: a Layout's
 * header shares the canvas's context with the page, a block in it can be
 * stored exactly as one on the page, and only the page's output wears the
 * markers that make its text editable. So is the host's policy, which a
 * block judges a remote host by: a host it now allows or refuses is judged
 * again rather than shown as it was.
 */
function editorOutputKey(
  marked: boolean,
  hostPolicy: BlockHostPolicy | undefined,
  name: string,
  className: string,
  node: BlockNode,
  bound: BoundValues | undefined
): string | undefined {
  try {
    return JSON.stringify([
      marked,
      hostPolicy ?? null,
      name,
      className,
      node,
      bound ?? null,
    ]);
  } catch {
    // A node a stringify cannot write (a cycle, a bigint) is drawn afresh.
    return undefined;
  }
}

function keepEditorOutput(
  context: PageContext,
  key: string,
  output: PromiseLike<unknown>
): void {
  let kept = EDITOR_OUTPUTS.get(context);
  if (kept === undefined) {
    kept = new Map();
    EDITOR_OUTPUTS.set(context, kept);
  }
  kept.set(key, output);
  if (kept.size > EDITOR_OUTPUTS_KEPT) {
    const oldest = kept.keys().next();
    if (oldest.done !== true) kept.delete(oldest.value);
  }
}

/** Where a block's output comes from on this render, and where it is kept. */
interface EditorOutputSlot {
  /** The output kept for this block as it stands, or the one `run` makes. */
  readonly output: (run: () => unknown) => unknown;
  /** Keep an async output just made, for the next time the page is drawn. */
  readonly keep: (output: PromiseLike<unknown>) => void;
}

/** A published render's slot: every output is made afresh and none is kept. */
const UNKEPT: EditorOutputSlot = {
  output: run => run(),
  keep: () => undefined,
};

/**
 * A block's output slot: on an editor render, the output kept for it as it
 * stands; on a published one, or where the block cannot be keyed, none. See
 * `EDITOR_OUTPUTS`.
 */
export function editorOutputSlot(
  editorRender: boolean,
  marked: boolean,
  hostPolicy: BlockHostPolicy | undefined,
  context: PageContext,
  name: string,
  className: string,
  node: BlockNode,
  bound: BoundValues | undefined
): EditorOutputSlot {
  if (!editorRender) return UNKEPT;
  const key = editorOutputKey(marked, hostPolicy, name, className, node, bound);
  if (key === undefined) return UNKEPT;
  const outputs = EDITOR_OUTPUTS.get(context);
  const kept = outputs?.get(key);
  if (outputs !== undefined && kept !== undefined) {
    // Used again, so the newest: a header drawn on every edit is not dropped
    // behind the page's many edited blocks.
    outputs.delete(key);
    outputs.set(key, kept);
  }
  return {
    output: run => kept ?? run(),
    keep: output => {
      if (kept === undefined) keepEditorOutput(context, key, output);
    },
  };
}

/**
 * Reads an async block's output with the same containment the sync path has.
 *
 * A component of its own, so only blocks that are actually asynchronous wait,
 * and a page of forty ordinary sections is not forty streaming chunks. Read
 * with `use` rather than by being an `async` component: the published page
 * renders on the server, where either works, but the editor renders the same
 * tree in the browser, where React refuses an async component.
 */
export function AsyncBlockOutput({
  pending,
  node,
  fallback,
  isBlockRoot,
  declaresNothing,
  declaresSlots,
  nodeAttribute,
  identity,
}: {
  pending: PromiseLike<unknown>;
  node: BlockNode;
  fallback: ReactNode;
  isBlockRoot: boolean;
  /** Carried from the caller, which asked the definition once before rendering. */
  declaresNothing: boolean;
  /** Carried from the caller, which asked the definition once before rendering. */
  declaresSlots: boolean;
  /** Whether the editor asked for a per-node DOM address. */
  nodeAttribute?: boolean;
  /** The editor address, snapshotted before the block rendered. */
  identity: EditorIdentity;
}): ReactNode {
  const settled = use(settledOf(pending));
  if (settled.ok) {
    return checkedOutput(
      settled.value,
      node,
      fallback,
      isBlockRoot,
      declaresNothing,
      declaresSlots,
      nodeAttribute,
      identity
    );
  }
  return (
    <BlockPlaceholder
      reason="render-error"
      type={node.type}
      id={node.id}
      editor={placeholderEditor(nodeAttribute, identity)}
      detail={describeThrown(settled.error)}
    />
  );
}
