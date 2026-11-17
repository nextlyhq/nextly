"use client";

/**
 * The inspector's Content tab: the block's own inspector or the generated
 * fields of the settings it places in Content; and the one write path every
 * content control shares.
 *
 * @module inspector-content-tab
 */

import {
  findNode,
  type BlockDocument,
  type BlockInspectorProps,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { columnsContentSection } from "./columns-layout-field";
import {
  PropExposeControl,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { FORM_BLOCK } from "./form-picked";
import { formSectionBodies, formSourceSections } from "./form-sections";
import { useFormSources } from "./form-source-control";
import { galleryContentSections } from "./gallery-fields";
import {
  blockIsReadOnly,
  builderContentSectionsOf,
  contentRowsOf,
  designReadOnlyReason,
  fieldLabel,
  lockViewOf,
  propIsWritable,
  propPatch,
  type BlockInspection,
  type EditableProp,
} from "./inspector";
import { ContentFields, listViewOf } from "./inspector-content-fields";
import type { BlockInspectorResolver } from "./inspector-panel-types";
import { keptWhileHidden, ownBlockChanged } from "./kept-while-hidden";
import { commitLinkChanges } from "./link-control";
import {
  PanelSections,
  rowsHoldValue,
  type PanelSection,
} from "./panel-section";
import { useSettingsMatch } from "./settings-filter";
import {
  useVisitorUnreadable,
  VisitorUnreadableNote,
} from "./visitor-unreadable-context";

/**
 * The Content tab: what the block says, shows or links to. Kept mounted while
 * hidden, so a field's uncommitted text survives a look at another tab; drawn
 * again then only when its own block changes.
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
  reasonId,
  fields,
  around,
}: {
  block: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  /** The id of the lock reason held controls point to, in the card. */
  reasonId: string;
  /** Whether the Content tab is the one showing. */
  onScreen: boolean;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
  /** The page around the block, for a section the builder draws itself. */
  around?: ContentAround | undefined;
}): React.JSX.Element {
  return (
    <ContentSurface
      // Keyed by node, so a custom inspector holding local state does not
      // carry one block's draft to the next, as the generated fields do not.
      key={`${block.nodeId}:content`}
      inspection={block}
      editor={editor}
      onCommit={commit}
      inspectors={inspectors}
      services={services}
      reasonId={reasonId}
      fields={fields}
      around={around}
    />
  );
}

/**
 * What a section the builder draws in Content reads of the page around the
 * block: Columns' Stack on names the site's devices, and reads a stack
 * reaching the row through the canvas's cascade.
 */
interface ContentAround {
  readonly breakpoints: BreakpointSet | undefined;
  readonly cascade: PageStyleCascade | undefined;
  readonly renderedTag: string | undefined;
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

/** The Content sections the builder draws itself for the block, if any. */
function builderSectionsOf(
  inspection: BlockInspection,
  editor: EditorState,
  around: ContentAround | undefined,
  reasonId: string,
  services: ContentServices | undefined
): PanelSection[] {
  const labels = builderContentSectionsOf(inspection.blockName);
  if (labels.length === 0) return [];
  // Layout, Stack on, Columns and On mobile write the block's design, so a
  // design lock holds them.
  const designHeldBy =
    designReadOnlyReason(
      editor.document,
      inspection.nodeId,
      lockViewOf(editor)
    ) === undefined
      ? undefined
      : reasonId;
  const gallery = galleryContentSections(
    {
      editor,
      nodeId: inspection.nodeId,
      breakpoints: around?.breakpoints,
      services,
      reasonId,
      designHeldBy,
    },
    labels
  );
  if (gallery.length > 0) return gallery;
  const [label] = labels;
  if (label === undefined) return [];
  const section = columnsContentSection({
    editor,
    nodeId: inspection.nodeId,
    blockName: inspection.blockName,
    label,
    breakpoints: around?.breakpoints,
    cascade: around?.cascade,
    renderedTag: around?.renderedTag,
    heldBy: designHeldBy,
  });
  return section === undefined ? [] : [section];
}

/**
 * The builder's sections and the block's own, as one list: a block's
 * section named as one the builder draws is drawn inside it, after the
 * builder's controls, so the two never share a name in one tab.
 */
function joinedSections(
  builder: readonly PanelSection[],
  own: readonly PanelSection[]
): PanelSection[] {
  const named = new Set(builder.map(section => section.key));
  return [
    ...builder.map(section => {
      const same = own.find(each => each.key === section.key);
      if (same === undefined) return section;
      return {
        ...section,
        holdsValue: section.holdsValue || same.holdsValue,
        body: (
          <>
            {section.body}
            {same.body}
          </>
        ),
      };
    }),
    ...own.filter(section => !named.has(section.key)),
  ];
}

/**
 * The Content tab: the block's own inspector where it names one the host
 * loaded, and the generated fields otherwise.
 *
 * Only the content controls are replaced. The identity fields above the tabs,
 * the whole Style tab and the whole Advanced tab are drawn for every block,
 * so a plugin's inspector cannot lose them.
 */
function ContentSurface({
  inspection,
  editor,
  onCommit,
  inspectors,
  services,
  reasonId,
  fields,
  around,
}: {
  inspection: BlockInspection;
  editor: EditorState;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  inspectors: BlockInspectorResolver | undefined;
  services: ContentServices | undefined;
  reasonId: string;
  /** The component's own view, when the document is a component. */
  fields: ComponentFieldsBinding | undefined;
  around: ContentAround | undefined;
}): React.JSX.Element {
  // A block's own inspector knows nothing of bindings visitors will not see,
  // so beside one, every such binding on the block is said above it.
  const unreadable = useVisitorUnreadable(inspection.nodeId);
  const filterOn = useSettingsMatch().active;
  const fieldsFor = (rows: readonly EditableProp[]): React.JSX.Element => (
    <ContentFields
      inspection={inspection}
      rows={rows}
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
  // The Form's Fields and After sending, which the builder draws in place
  // of their generated rows.
  const stored = findNode(editor.document.nodes, inspection.nodeId)?.props ?? {};
  const formWritable = (name: string) =>
    propIsWritable(editor.document, inspection.nodeId, name, lockViewOf(editor));
  // Where a Form's form comes from, read only while a Form is inspected.
  const formSources = useFormSources(
    inspection.blockName === FORM_BLOCK ? services?.listForms : undefined
  );
  const formBodies = formSectionBodies({
    inspection,
    stored,
    services,
    writable: formWritable,
    onCommit: (name, value) => {
      onCommit(name, value);
    },
    rowsOf: fieldsFor,
    exposeOf:
      fields === undefined
        ? undefined
        : prop => (
            <PropExposeControl
              binding={fields}
              nodeId={inspection.nodeId}
              prop={prop}
            />
          ),
  });
  // Each section the block places in Content, folding on its own, after
  // the ones the builder draws for a core block (Columns' layout, a
  // Gallery's Pictures and Layout); a block
  // with none draws the fields' own note that there is nothing to set.
  const sections = joinedSections(
    [
      ...formSourceSections({
        inspection,
        stored,
        sources: formSources,
        writable: formWritable,
        onCommit: (name, value) => {
          onCommit(name, value);
        },
      }),
      ...builderSectionsOf(inspection, editor, around, reasonId, services),
    ],
    // A section the builder draws as `null` is one the block has no use
    // for as it stands: a picked form's own fields.
    inspection.sections.content.flatMap(section => {
      const body =
        formBodies?.has(section.label) === true
          ? formBodies.get(section.label)
          : fieldsFor(section.rows);
      return body === null || body === undefined
        ? []
        : [
            {
              key: section.label,
              label: section.label,
              holdsValue: rowsHoldValue(section.rows),
              body,
            },
          ];
    })
  );
  const generated =
    sections.length === 0 ? (
      fieldsFor(contentRowsOf(inspection))
    ) : (
      <PanelSections tab="content" sections={sections} />
    );
  const Custom =
    inspection.inspector === undefined
      ? undefined
      : inspectors?.(inspection.inspector);
  // While the panel is filtered, the generated fields are drawn, which the
  // filter can hide row by row; the block's own inspector knows nothing of it.
  if (Custom === undefined || filterOn) return generated;
  return (
    <>
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

/**
 * Each Content setting's expose switch, for a block whose own inspector draws
 * its controls. The Advanced tab draws its own settings' switches.
 */
function ExposeRows({
  inspection,
  fields,
}: {
  inspection: BlockInspection;
  fields: ComponentFieldsBinding;
}): React.JSX.Element {
  return (
    <div className="nx-inspector__fields" data-expose-rows="">
      {contentRowsOf(inspection).map(prop => (
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
