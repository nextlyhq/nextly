"use client";

/**
 * The inspector's Advanced tab: where the block shows and how it is built
 * into the page. Visibility first (which devices, which entries, search
 * previews), then HTML (the block's own HTML settings such as its tag, its
 * anchor, its CSS classes and its attributes), then any other Advanced
 * section the block declares.
 *
 * The builder draws the shared settings here for every block, whatever the
 * block declares, so no block can leave them out or draw them elsewhere; a
 * block's own inspector replaces only its Content controls.
 *
 * @module inspector-advanced-tab
 */

import {
  BASE_BREAKPOINT,
  findNode,
  type BlockDocument,
  type BlockNode,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import * as React from "react";

import { AdvancedPanel } from "./advanced-panel";
import {
  VisibilityExposeControl,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import { ShowWhen } from "./conditions/condition-controls";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import {
  designReadOnlyReason,
  lockViewOf,
  propIsWritable,
  type BlockInspection,
  type EditableProp,
} from "./inspector";
import { ContentFields, listViewOf } from "./inspector-content-fields";
import { keptWhileHidden, ownBlockChanged } from "./kept-while-hidden";
import { commitLinkChanges } from "./link-control";
import { NeverQuote } from "./never-quote";
import { PanelSections, rowsHoldValue } from "./panel-section";
import { VisibleOn, type BreakpointsStatus } from "./visible-on";

/** The Advanced section the builder's own HTML settings join. */
export const VISIBILITY_SECTION = "Visibility";
export const HTML_SECTION = "HTML";

/**
 * The Advanced tab. Kept mounted while hidden, so a half-typed attribute
 * survives a look at another tab; drawn again then only when its own block
 * changes.
 */
export const AdvancedTab: React.NamedExoticComponent<
  React.ComponentProps<typeof DrawnAdvancedTab>
> = keptWhileHidden(DrawnAdvancedTab, ownBlockChanged);

function DrawnAdvancedTab({
  block,
  editor,
  onCommit,
  services,
  blocks,
  onScreen,
  reasonId,
  fields,
  breakpoints,
  breakpoint,
  breakpointsStatus,
}: {
  block: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  services: ContentServices | undefined;
  blocks: BlockResolver | undefined;
  /** Whether the Advanced tab is the one showing. */
  onScreen: boolean;
  /** The id of the lock reason held controls point to, in the card. */
  reasonId: string;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
  /** The site's breakpoints, for "Visible on". */
  breakpoints: BreakpointSet | undefined;
  /** The device being edited; the base one where the host names none. */
  breakpoint: BreakpointId | undefined;
  /** Whether `breakpoints` is the site's own set yet. */
  breakpointsStatus: BreakpointsStatus;
}): React.JSX.Element {
  const designLocked = designReadOnlyReason(
    editor.document,
    block.nodeId,
    lockViewOf(editor)
  );
  // The block's own Advanced settings, by section: those in HTML are drawn
  // above the anchor, the others in sections of their own after it.
  const { htmlRows, visibilityRows, others } = advancedRowsBySection(
    block.sections.advanced
  );
  const fieldsFor = (rows: readonly EditableProp[]): React.JSX.Element => (
    <ContentFields
      inspection={block}
      rows={rows}
      onCommit={onCommit}
      services={services}
      reasonId={reasonId}
      fields={fields}
      writable={name =>
        propIsWritable(editor.document, block.nodeId, name, lockViewOf(editor))
      }
      onCommitMany={changes => commitLinkChanges(editor, block.nodeId, changes)}
      onApply={op => editor.apply(op) !== null}
      document={editor.document}
      listView={listViewOf(editor, block.nodeId)}
    />
  );

  const visibility = (
    <>
      {/* In a component's own view: whether each page may hide the block. */}
      {fields === undefined ? null : (
        <VisibilityExposeControl
          binding={fields}
          nodeId={block.nodeId}
          blockName={block.label}
        />
      )}
      {/* Which devices the block shows on. */}
      <VisibleOn
        editor={editor}
        nodeId={block.nodeId}
        breakpoints={breakpoints}
        editing={breakpoint ?? BASE_BREAKPOINT}
        status={breakpointsStatus}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* Whether the block shows at all, by the entry or list item it is
          drawn with. Keyed by the block, so a row added and not yet
          finished stays with the block it was added to rather than moving
          to the next one. */}
      <ShowWhen
        key={block.nodeId}
        editor={editor}
        nodeId={block.nodeId}
        services={services}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* Whether search engines may quote the block's text. Drawn only on a
          container. */}
      <NeverQuote
        editor={editor}
        nodeId={block.nodeId}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* The block's own settings it places in Visibility. */}
      {visibilityRows.length === 0 ? null : fieldsFor(visibilityRows)}
    </>
  );
  const html = (
    <>
      {htmlRows.length === 0 ? null : fieldsFor(htmlRows)}
      {/*
        Held while the design is locked: every native control inside is
        read-only at once and points at the reason in the card, and the
        panel's own write path refuses what the save would.
      */}
      <HeldByLock reasonId={designLocked === undefined ? undefined : reasonId}>
        <AdvancedPanel
          // Keyed by node, so a half-typed attribute does not travel to the
          // next block the way an uncommitted name would. The panel holds
          // rows locally; without this an author would select another block
          // and find this one's unsaved row waiting there.
          key={`${block.nodeId}:advanced`}
          nodeId={block.nodeId}
          cssId={block.html.cssId}
          attributes={block.html.attributes}
          editor={editor}
          active={onScreen}
          blocks={blocks}
        />
      </HeldByLock>
    </>
  );
  const node = findNode(editor.document.nodes, block.nodeId);
  // Visibility first, then HTML, then any section the block declares, for
  // every block.
  return (
    <PanelSections
      tab="advanced"
      sections={[
        {
          key: "visibility",
          label: VISIBILITY_SECTION,
          holdsValue:
            visibilityHoldsValue(node) || rowsHoldValue(visibilityRows),
          body: visibility,
        },
        {
          key: "html",
          label: HTML_SECTION,
          holdsValue: htmlHoldsValue(block, htmlRows),
          body: html,
        },
        ...others.map(section => ({
          key: `own:${section.label}`,
          label: section.label,
          holdsValue: rowsHoldValue(section.rows),
          body: fieldsFor(section.rows),
        })),
      ]}
    />
  );
}

/**
 * A block's own Advanced settings by where they are drawn: its Visibility and
 * HTML settings join the builder's sections of those names, so each is one
 * section, folded as one; any other section it declares is its own.
 */
export function advancedRowsBySection(own: BlockInspection["sections"]["advanced"]): {
  htmlRows: readonly EditableProp[];
  visibilityRows: readonly EditableProp[];
  others: BlockInspection["sections"]["advanced"];
} {
  const rowsOf = (label: string) =>
    own.find(section => section.label === label)?.rows ?? [];
  return {
    htmlRows: rowsOf(HTML_SECTION),
    visibilityRows: rowsOf(VISIBILITY_SECTION),
    others: own.filter(
      section =>
        section.label !== HTML_SECTION && section.label !== VISIBILITY_SECTION
    ),
  };
}

/** Whether the block's HTML holds a value: a CSS id, attributes, a setting. */
function htmlHoldsValue(
  block: BlockInspection,
  rows: readonly EditableProp[]
): boolean {
  return (
    block.html.cssId !== undefined ||
    block.html.attributes !== undefined ||
    rowsHoldValue(rows)
  );
}

/**
 * Whether the block's Visibility holds a value: a device it is hidden on, a
 * condition it shows by, or the mark that keeps it out of search previews.
 */
export function visibilityHoldsValue(node: BlockNode | undefined): boolean {
  if (node === undefined) return false;
  const { visibility } = node;
  const devices = visibility?.devices;
  const hidden =
    devices !== undefined && Object.values(devices).some(shown => !shown);
  const conditions = visibility?.conditions;
  return (
    hidden ||
    (Array.isArray(conditions) && conditions.length > 0) ||
    node.nosnippet === true
  );
}
