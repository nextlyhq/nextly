"use client";

/**
 * "Never quote this" in the Content tab: one switch that marks a Section or
 * a Box so its root element carries `data-nosnippet`, which keeps its text
 * out of search snippets, Google's AI Overviews and AI Mode among them,
 * while visitors still see it. A Page Builder setting about the block's own
 * HTML, so it works with or without an SEO plugin.
 *
 * Google reads the mark on `span`, `div` and `section` elements only
 * (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag),
 * so a block whose tag is another one says so rather than being wrapped in
 * an element the page did not ask for.
 *
 * @module never-quote
 */

import { findNode, type BlockNode } from "@nextlyhq/blocks-engine";
import { containerRootTag } from "@nextlyhq/blocks-react";
import { Switch } from "@nextlyhq/ui";
import * as React from "react";

import type { EditorState } from "./editor-state";
import type { BuilderOp } from "./op-vocabulary";

/** The blocks the mark is offered on, and whether each may render a link. */
const MARKABLE: Readonly<Record<string, { linkable: boolean }>> = {
  "core/section": { linkable: false },
  "core/box": { linkable: true },
};

/** The tags Google reads `data-nosnippet` on that a container may render. */
const READ_ON: ReadonlySet<string> = new Set(["section", "div"]);

/** Whether the mark is offered on `node`: a Section or a Box. */
function offersNeverQuote(node: Pick<BlockNode, "type">): boolean {
  return Object.hasOwn(MARKABLE, node.type);
}

/** Whether Google reads the mark on the element `node` renders as its root. */
function readByGoogle(node: BlockNode): boolean {
  const linkable = MARKABLE[node.type]?.linkable ?? false;
  return READ_ON.has(containerRootTag(node.props, linkable));
}

/**
 * The op that marks the node or clears its mark: stored only while on, so a
 * block never marked keeps the document it had.
 */
function neverQuoteOp(nodeId: string, on: boolean): BuilderOp {
  return on
    ? { kind: "update", id: nodeId, patch: { nosnippet: true } }
    : { kind: "update", id: nodeId, patch: {}, unset: ["nosnippet"] };
}

export interface NeverQuoteProps {
  readonly editor: EditorState;
  readonly nodeId: string;
  /**
   * Why a lock holds the block's design, or `undefined` while nothing does:
   * what its root element carries is part of it, as its id and attributes are.
   */
  readonly heldBy?: string | undefined;
  /** The id of the element saying why, which a held switch points to. */
  readonly reasonId?: string;
}

export function NeverQuote({
  editor,
  nodeId,
  heldBy,
  reasonId,
}: NeverQuoteProps): React.JSX.Element | null {
  const id = React.useId();
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined || !offersNeverQuote(node)) return null;
  const on = node.nosnippet === true;
  const titleId = `${id}-title`;
  const describedBy = [
    `${id}-help`,
    ...(heldBy !== undefined && reasonId !== undefined ? [reasonId] : []),
  ].join(" ");
  return (
    <section
      className="nx-list-query__group nx-never-quote"
      aria-labelledby={titleId}
      data-never-quote=""
    >
      <div className="nx-never-quote__head">
        <h3 id={titleId} className="nx-list-query__title">
          Never quote this
        </h3>
        <Switch
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          checked={on}
          disabled={heldBy !== undefined}
          onCheckedChange={next => editor.apply(neverQuoteOp(nodeId, next))}
        />
      </div>
      <p className="nx-inspector__note" id={`${id}-help`}>
        Google won&apos;t show this section&apos;s text under the page&apos;s
        link, or use it as a direct source in AI Overviews and AI Mode. Visitors
        still see it.
      </p>
      {on ? (
        <p className="nx-inspector__note nx-never-quote__on">
          On: marked <code>data-nosnippet</code>.
        </p>
      ) : null}
      {on && !readByGoogle(node) ? (
        <p className="nx-inspector__note nx-never-quote__caution">
          Google reads this only when the HTML tag is section or div.
        </p>
      ) : null}
    </section>
  );
}
