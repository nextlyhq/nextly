"use client";

/**
 * The inspector's Content tab: the block's own inspector or its generated
 * fields, then where it shows, when it shows and Advanced; and the one write
 * path every content control shares.
 *
 * @module inspector-content-tab
 */

import {
  findNode,
  type BlockDocument,
  type BlockInspectorProps,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { AdvancedPanel } from "./advanced-panel";
import {
  PropExposeControl,
  VisibilityExposeControl,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import { ShowWhen } from "./condition-controls";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import {
  blockIsReadOnly,
  designReadOnlyReason,
  fieldLabel,
  lockViewOf,
  propIsWritable,
  propPatch,
  type BlockInspection,
} from "./inspector";
import { ContentFields, listViewOf } from "./inspector-content-fields";
import type { BlockInspectorResolver } from "./inspector-panel-types";
import { keptWhileHidden, ownBlockChanged } from "./kept-while-hidden";
import { commitLinkChanges } from "./link-control";
import { NeverQuote } from "./never-quote";
import { VisibleOn, type BreakpointsStatus } from "./visible-on";
import {
  useVisitorUnreadable,
  VisitorUnreadableNote,
} from "./visitor-unreadable-context";

/**
 * The Content tab: the block's own fields, then Advanced (CSS id, attributes).
 * Hidden, it is drawn again only when its own block changes.
 */
export const ContentTab: React.NamedExoticComponent<
  React.ComponentProps<typeof DrawnContentTab>
> = keptWhileHidden(DrawnContentTab, ownBlockChanged);

function DrawnContentTab({
  block,
  editor,
  onCommit: commit,
  inspectors,
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
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  blocks: BlockResolver | undefined;
  /** The id of the lock reason held controls point to, in the card. */
  reasonId: string;
  /** Whether the Content tab is the one showing. */
  onScreen: boolean;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
  /** The site's breakpoints, for "Visible on". */
  breakpoints: BreakpointSet | undefined;
  /** The device being edited. */
  breakpoint: BreakpointId;
  /** Whether `breakpoints` is the site's own set yet. */
  breakpointsStatus: BreakpointsStatus;
}): React.JSX.Element {
  // Whether the Advanced section is open, so the panel inside it can be told
  // when it stops being on screen and settle its draft.
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const designLocked = designReadOnlyReason(
    editor.document,
    block.nodeId,
    lockViewOf(editor)
  );

  return (
    <>
      <ContentSurface
        // Keyed by node, so a custom inspector holding local state does not
        // carry one block's draft to the next, as the generated fields do
        // not.
        key={`${block.nodeId}:content`}
        inspection={block}
        editor={editor}
        onCommit={commit}
        inspectors={inspectors}
        services={services}
        reasonId={reasonId}
        fields={fields}
      />
      {/* Which devices the block shows on: after its own fields, before the
          Advanced section, as the design draws the Content tab. */}
      <VisibleOn
        editor={editor}
        nodeId={block.nodeId}
        breakpoints={breakpoints}
        editing={breakpoint}
        status={breakpointsStatus}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* Whether the block shows at all, by the entry or list item it is drawn
          with: beside where it shows, as the design draws the Content tab. */}
      {/* Keyed by the block, so a row added and not yet finished stays with
          the block it was added to rather than moving to the next one. */}
      <ShowWhen
        key={block.nodeId}
        editor={editor}
        nodeId={block.nodeId}
        services={services}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      {/* Whether search engines may quote the block's text: after Show when,
          before Advanced, as the design draws the Content tab. Drawn only on
          a Section or a Box. */}
      <NeverQuote
        editor={editor}
        nodeId={block.nodeId}
        heldBy={designLocked}
        reasonId={reasonId}
      />
      <details className="nx-inspector__advanced" open={advancedOpen}>
        {/*
        Opened from the summary's own click, which a keyboard's Enter and
        Space also raise, rather than from the element's toggle event:
        that event arrives a task later, and the panel inside must know
        it is on screen in the same render the author opened it.
      */}
        <summary
          onClick={event => {
            event.preventDefault();
            setAdvancedOpen(open => !open);
          }}
        >
          <ChevronRight
            className="nx-inspector__advanced-chevron"
            size={16}
            aria-hidden="true"
          />
          Advanced
        </summary>
        {/*
          Held while the design is locked: every native control inside is
          read-only at once and points at the reason in the card, and the
          panel's own write path refuses what the save would.
        */}
        <HeldByLock
          reasonId={designLocked === undefined ? undefined : reasonId}
        >
          <AdvancedPanel
            // Keyed by node, so a half-typed attribute does not travel to
            // the next block the way an uncommitted name would. The panel
            // holds rows locally; without this an author would select
            // another block and find this one's unsaved row waiting there.
            key={`${block.nodeId}:advanced`}
            nodeId={block.nodeId}
            cssId={block.html.cssId}
            attributes={block.html.attributes}
            editor={editor}
            active={onScreen && advancedOpen}
            blocks={blocks}
          />
        </HeldByLock>
      </details>
    </>
  );
}

/**
 * Set one prop of one node: the one write path every content control shares.
 *
 * The patch is built from the node in `document`, which the caller passes as
 * the document the edit applies to, and the result is returned so a caller
 * making several edits in a row can build the next one on it. The props are
 * copied whole (`propPatch`), so a patch built from an older copy would put
 * back every value an edit since then changed.
 *
 * @returns the document after the edit, or `null` when it was not applied
 */
export function commitProp(
  editor: EditorState,
  document: BlockDocument,
  id: string,
  name: string,
  value: unknown
): BlockDocument | null {
  // Refused here, for every caller: a lock set after a field drew must still
  // stop the write, and inside a `contentOnly` area only content may change.
  if (!propIsWritable(document, id, name, lockViewOf(editor))) return null;
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  return editor.apply({
    kind: "update",
    id,
    patch: propPatch(node, name, value),
  });
}

/**
 * The Content tab: the block's own inspector where it names one the host
 * loaded, and the generated fields otherwise.
 *
 * Only the content controls are replaced. The identity fields above the tabs,
 * the Advanced tab's CSS id and attributes and the whole Style tab are drawn
 * for every block, so a plugin's inspector cannot lose them.
 */
function ContentSurface({
  inspection,
  editor,
  onCommit,
  inspectors,
  services,
  reasonId,
  fields,
}: {
  inspection: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  reasonId: string;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
}): React.JSX.Element {
  // A block's own inspector knows nothing of bindings visitors will not see,
  // so beside one, every such binding on the block is said above it.
  const unreadable = useVisitorUnreadable(inspection.nodeId);
  const generated = (
    <ContentFields
      inspection={inspection}
      onCommit={onCommit}
      services={services}
      reasonId={reasonId}
      fields={fields}
      writable={name =>
        propIsWritable(
          editor.document,
          inspection.nodeId,
          name,
          lockViewOf(editor)
        )
      }
      onCommitMany={changes =>
        commitLinkChanges(editor, inspection.nodeId, changes)
      }
      // A binding's edits, applied as any other edit of the block.
      // Whether the editor took it: a refused edit is said, not assumed.
      onApply={op => editor.apply(op) !== null}
      document={editor.document}
      listView={listViewOf(editor, inspection.nodeId)}
    />
  );
  const Custom =
    inspection.inspector === undefined
      ? undefined
      : inspectors?.(inspection.inspector);
  const visibility =
    fields === undefined ? null : (
      <VisibilityExposeControl
        binding={fields}
        nodeId={inspection.nodeId}
        blockName={inspection.label}
      />
    );
  if (Custom === undefined) {
    return (
      <>
        {visibility}
        {generated}
      </>
    );
  }
  return (
    <>
      {visibility}
      <VisitorUnreadableNote
        bindings={unreadable}
        props={new Set(unreadable.map(binding => binding.prop))}
        // A library fallback named by its file, as the image row names it.
        services={services}
      />
      <CustomInspectorBoundary fallback={generated}>
        <CustomInspector
          Inspector={Custom}
          nodeId={inspection.nodeId}
          editor={editor}
        />
        {/*
          A block's own inspector draws its own controls and knows nothing of
          exposing them, so in a component's view its props are listed again
          beneath it, each with its switch.
        */}
        {fields === undefined ? null : (
          <ExposeRows inspection={inspection} fields={fields} />
        )}
      </CustomInspectorBoundary>
    </>
  );
}

/** Each prop's expose switch, for a block whose own inspector draws its controls. */
function ExposeRows({
  inspection,
  fields,
}: {
  inspection: BlockInspection;
  fields: ComponentFieldsBinding;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__fields" data-expose-rows="">
      {inspection.props.map(prop => (
        <div
          key={`${inspection.nodeId}:${prop.name}:expose`}
          className="nx-inspector__prop"
        >
          <p className="nx-inspector__note">{fieldLabel(prop.name)}</p>
          <PropExposeControl
            binding={fields}
            nodeId={inspection.nodeId}
            prop={prop}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A block's own inspector, given the contract every one is given.
 *
 * `commit` is the generated controls' own write path, addressed to THIS node
 * rather than to whatever is selected when it is called, with one guard in
 * front, asked of the document at the moment of the call: nothing is written
 * to a locked block, and inside a `"contentOnly"` area only its content props
 * are. `readOnly` tells the component to draw itself disabled, but the
 * component is plugin code, and a lock that held only while the plugin
 * honoured a flag would not be a lock. So the refusal is here, whatever the
 * component does with the flag.
 */
function CustomInspector({
  Inspector,
  nodeId,
  editor,
}: {
  Inspector: React.ComponentType<BlockInspectorProps>;
  nodeId: string;
  editor: EditorState;
}): React.JSX.Element | null {
  /*
   * The editor and the document every commit reads, held where any copy of
   * `commit` sees the latest.
   *
   * A component may commit twice in one handler, before the panel re-renders,
   * or hold `commit` across an await while the document moves on. Either way
   * the render's `editor.document` is out of date when the call runs, and a
   * patch built from it would put back what changed in between (`propPatch`
   * copies the props whole) and miss a lock set meanwhile. So each render
   * publishes its editor here, each commit advances the document to what its
   * own write produced, and the callback itself never changes.
   */
  const live = React.useRef({ editor, document: editor.document });
  useIsomorphicLayoutEffect(() => {
    live.current = { editor, document: editor.document };
  }, [editor]);
  const commit = React.useCallback(
    (name: string, value: unknown): void => {
      const { editor: current, document } = live.current;
      if (!propIsWritable(document, nodeId, name, lockViewOf(current))) {
        return;
      }
      const next = commitProp(current, document, nodeId, name, value);
      if (next !== null) live.current = { editor: current, document: next };
    },
    [nodeId]
  );
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  return (
    <div className="nx-inspector__fields" data-inspector="custom">
      <Inspector
        node={node}
        props={node.props}
        commit={commit}
        readOnly={blockIsReadOnly(editor.document, nodeId)}
      />
    </div>
  );
}

/**
 * Keeps a plugin inspector that throws from taking the editor down with it.
 *
 * The generated controls are drawn instead, with a note, so the author can go
 * on editing the block: a broken plugin component is a reason to lose its
 * nicer controls, never the block's content.
 */
class CustomInspectorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p className="nx-inspector__note" role="status">
          This block&apos;s own controls could not be shown, so its standard
          controls are shown instead.
        </p>
        {this.props.fallback}
      </>
    );
  }
}
