"use client";

/**
 * The inspector's Advanced tab: where the block shows and how it is built
 * into the page. Visibility first (which devices, which entries, search
 * previews), then HTML (the block's own HTML settings, its CSS id and its
 * attributes), then any other Advanced section the block declares.
 *
 * The builder draws the shared settings here for every block, whatever the
 * block declares, so no block can leave them out or draw them elsewhere; a
 * block's own inspector replaces only its Content controls.
 *
 * @module inspector-advanced-tab
 */

import {
  BASE_BREAKPOINT,
  type BlockDocument,
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
import { ShowWhen } from "./condition-controls";
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
import { VisibleOn, type BreakpointsStatus } from "./visible-on";

/** The Advanced section the builder's own HTML settings join. */
const HTML_SECTION = "HTML";

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
  const visibilityId = React.useId();
  const htmlId = React.useId();
  // The block's own Advanced settings, by section: those in HTML are drawn
  // above the CSS id, the others in sections of their own after it.
  const own = block.sections.advanced;
  const htmlRows =
    own.find(section => section.label === HTML_SECTION)?.rows ?? [];
  const others = own.filter(section => section.label !== HTML_SECTION);
  // The block's own settings, drawn by the same generated fields as Content.
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

  return (
    <>
      <section
        className="nx-inspector__group"
        aria-labelledby={visibilityId}
        data-advanced-section="visibility"
      >
        <h3 id={visibilityId} className="nx-inspector__heading">
          Visibility
        </h3>
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
            Section or a Box. */}
        <NeverQuote
          editor={editor}
          nodeId={block.nodeId}
          heldBy={designLocked}
          reasonId={reasonId}
        />
      </section>
      <section
        className="nx-inspector__group"
        aria-labelledby={htmlId}
        data-advanced-section="html"
      >
        <h3 id={htmlId} className="nx-inspector__heading">
          {HTML_SECTION}
        </h3>
        {htmlRows.length === 0 ? null : fieldsFor(htmlRows)}
        {/*
          Held while the design is locked: every native control inside is
          read-only at once and points at the reason in the card, and the
          panel's own write path refuses what the save would.
        */}
        <HeldByLock
          reasonId={designLocked === undefined ? undefined : reasonId}
        >
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
      </section>
      {others.map(section => (
        <OwnSection
          key={`${block.nodeId}:${section.label}`}
          label={section.label}
        >
          {fieldsFor(section.rows)}
        </OwnSection>
      ))}
    </>
  );
}

/** One more Advanced section the block declares, under its own name. */
function OwnSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <section className="nx-inspector__group" aria-labelledby={id}>
      <h3 id={id} className="nx-inspector__heading">
        {label}
      </h3>
      {children}
    </section>
  );
}
