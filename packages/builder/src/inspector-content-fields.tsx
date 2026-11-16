"use client";

/**
 * The Content tab's generated fields: one field per declared prop, grouped,
 * with a list's view and the binding a link group is drawn with.
 *
 * @module inspector-content-fields
 */

import {
  authoredText,
  findNode,
  type BlockDocument,
  type BuilderOp,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { BindableField } from "./binding-controls";
import {
  PropExposeControl,
  type ComponentFieldsBinding,
} from "./component-fields-panel";
import {
  contentControlFor,
  UnsupportedField,
  type ContentServices,
} from "./content-controls";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import {
  propLabel,
  type BlockInspection,
  type EditableProp,
} from "./inspector";
import {
  propGroupsOf,
  type BindableOptions,
  type BindableWrapper,
} from "./prop-groups";
import {
  useVisitorUnreadable,
  VisitorUnreadableNote,
} from "./visitor-unreadable-context";

/**
 * The prop whose binding a link group's lead is drawn with: the entry's,
 * where the link follows its bound entry, else the address's.
 *
 * The same precedence the renderer reads a link by (`linkFor` in
 * blocks-react's `blocks/props.ts`): an entry reference, both its halves
 * given, before the address. So a block whose entry is bound and whose
 * collection is set is drawn, and changed, as its entry, whether or not its
 * address is bound too; with no collection the renderer follows the address,
 * and so does the panel. A half counts as given stored or bound, as the
 * render fills a bound one before reading the link.
 */
function drawnBinding(
  lead: string,
  entry: BindableOptions["entryLink"],
  bindings: Readonly<Record<string, unknown>> | undefined,
  props: readonly EditableProp[]
): string {
  if (entry === undefined || bindings?.[entry.id] === undefined) return lead;
  const collection = props.find(prop => prop.name === entry.collection);
  // Read as the renderer reads it (`text`, which is `authoredText`).
  const given =
    bindings[entry.collection] !== undefined ||
    authoredText(collection?.value) !== "";
  return given ? entry.id : lead;
}

/** Whether the canvas draws a list's empty state, and the way to switch it. */
interface ListView {
  readonly showsEmpty: boolean;
  readonly onShowEmpty: (empty: boolean) => void;
  /** The count of the latest ask to fix this list's sort, when it has one. */
  readonly sortFieldAsked: number | undefined;
  /** Tag the list on the canvas while a new source waits for an input. */
  readonly onStillShowing: ((words: string | undefined) => void) | undefined;
}

/** A block's list view, where the editor keeps one. */
export function listViewOf(
  editor: EditorState,
  nodeId: string
): ListView | undefined {
  const show = editor.showListEmpty;
  if (show === undefined) return undefined;
  return {
    showsEmpty: editor.listsShowingEmpty?.has(nodeId) === true,
    onShowEmpty: empty => show(nodeId, empty),
    sortFieldAsked:
      editor.sortFieldAsked?.id === nodeId
        ? editor.sortFieldAsked.seq
        : undefined,
    onStillShowing:
      editor.tagListStillShowing === undefined
        ? undefined
        : words => editor.tagListStillShowing?.(nodeId, words),
  };
}

/** What a group is told of the list view: none drawn empty when none is kept. */
function listGroupView(listView: ListView | undefined): {
  showsEmpty: boolean;
  onShowEmpty: ListView["onShowEmpty"] | undefined;
  sortFieldAsked: number | undefined;
  onStillShowing: ListView["onStillShowing"];
} {
  return {
    showsEmpty: listView?.showsEmpty === true,
    onShowEmpty: listView?.onShowEmpty,
    sortFieldAsked: listView?.sortFieldAsked,
    onStillShowing: listView?.onStillShowing,
  };
}

/** The Content tab: one field per declared prop, or the note that there are none. */
export function ContentFields({
  inspection,
  onCommit,
  services,
  reasonId,
  fields,
  writable,
  onCommitMany,
  document,
  listView,
  onApply,
}: {
  inspection: BlockInspection;
  /** Apply one op as an edit: a binding's, which writes props and bindings at once. */
  onApply: (op: BuilderOp) => boolean;
  /** The document the block is in, for a group that reads around it. */
  document: BlockDocument;
  /** Whether the canvas draws this block's empty state, and the switch. */
  listView?: ListView | undefined;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  /** Several props written as one edit, for a block's prop groups. */
  onCommitMany: (
    changes: Readonly<Record<string, unknown>>
  ) => BlockDocument | null | void;
  services: ContentServices | undefined;
  /** The id of the lock reason a held field points to. */
  reasonId: string;
  /**
   * Whether one prop may be set: not on a locked block, and inside a
   * `contentOnly` area only for content props. The same rule the commit and
   * the save apply, asked so the field is drawn read-only rather than met with
   * a refusal.
   */
  writable: (name: string) => boolean;
  /** The component's own view, when the document is a component. */
  fields?: ComponentFieldsBinding | undefined;
}): React.JSX.Element {
  // The bindings on this block a visitor will not see filled, each said under
  // the field that draws its prop.
  const unreadable = useVisitorUnreadable(inspection.nodeId);
  // The block's bindings as the document holds them, so a bound prop draws
  // its chip in place of its own control.
  const bindings = findNode(document.nodes, inspection.nodeId)?.bindings;
  // A prop the inspector leaves out draws no control, but in a component's
  // view keeps its expose icon: a page may clear what hides it.
  const drawn = inspection.props.filter(
    prop => prop.offered || fields !== undefined
  );
  if (drawn.length === 0) {
    return (
      <p className="nx-inspector__note">
        This block has no editable properties.
      </p>
    );
  }
  // What the block holds, for a control whose choices depend on another of
  // its props: a loop's sort offers its collection's fields.
  const values = Object.fromEntries(
    inspection.props.map(prop => [prop.name, prop.value])
  );
  // Props an author reads as one thing (a link and what qualifies it, an
  // image's source, its alt text) are drawn as one group, where the group's
  // lead prop sits; the others it draws get no row of their own. Built from
  // the props the block offers, so a sibling its own `onlyWithout` hides is
  // neither drawn nor written by a group.
  const groups = propGroupsOf(inspection.props.filter(prop => prop.offered));
  const leads = new Map(groups.map(group => [group.lead, group]));
  const grouped = new Set(groups.flatMap(group => [...group.drawn]));
  // A group's prop wrapped in the same binding controls a prop on its own
  // row gets, for the props the group offers: one chip, one menu and one
  // note for every bindable prop, wherever it is drawn.
  const bindableIn = (offered: ReadonlySet<string>): BindableWrapper =>
    function wrapBindable(lead, field, options) {
      const entry = options?.entryLink;
      const name = drawnBinding(lead, entry, bindings, inspection.props);
      const prop = inspection.props.find(each => each.name === name);
      // Offered by the group's lead: a bound entry id is drawn in its place.
      if (prop === undefined || !prop.offered || !offered.has(lead)) {
        return field;
      }
      const clears = options?.clearsOnBind ?? [];
      return (
        <BindableField
          nodeId={inspection.nodeId}
          prop={prop}
          blockLabel={inspection.label}
          binding={bindings?.[name]}
          entryLink={entry}
          document={document}
          services={services}
          disabled={!writable(name)}
          onApply={onApply}
          clearsOnBind={clears}
          // The props a bind would empty that may not be written here: a
          // bind or a change that would empty one is held, while the
          // fallback and the unbind, which empty nothing, stay offered.
          clearsLocked={clears.filter(each => !writable(each))}
        >
          {field}
        </BindableField>
      );
    };
  return (
    <div className="nx-inspector__fields">
      {drawn.map(prop => {
        const group = leads.get(prop.name);
        if (group === undefined && grouped.has(prop.name)) {
          // Drawn inside its group, but in a component's view still a prop of
          // its own to expose: named, with its icon, as a prop the inspector
          // leaves out is, so a placement may still set it.
          return fields === undefined ? null : (
            <div
              key={`${inspection.nodeId}:${prop.name}`}
              className="nx-inspector__prop"
            >
              <p className="nx-inspector__note">
                {propLabel(prop.name, prop.schema)}
              </p>
              <PropExposeControl
                binding={fields}
                nodeId={inspection.nodeId}
                prop={prop}
              />
            </div>
          );
        }
        const groupField =
          group === undefined ? undefined : (
            <React.Fragment key={`${inspection.nodeId}:${prop.name}`}>
              {group.render({
                props: inspection.props,
                writable,
                reasonId,
                services,
                placedWith: inspection.placedWith,
                onCommitMany,
                document,
                nodeId: inspection.nodeId,
                ...listGroupView(listView),
                bindable: bindableIn(group.bindable),
              })}
            </React.Fragment>
          );
        // Under the field: the props it draws whose bound value a visitor
        // will not see, a group's included.
        const note = (
          <VisitorUnreadableNote
            bindings={unreadable}
            props={group === undefined ? new Set([prop.name]) : group.drawn}
            // A library fallback named by its file, as the image row names it.
            services={services}
          />
        );
        // Named as the block names it, so its icon is not drawn bare.
        const field = !prop.offered ? (
          <p className="nx-inspector__note">
            {propLabel(prop.name, prop.schema)}
          </p>
        ) : (
          (groupField ?? (
            <HeldByLock
              // Keyed by node AND prop: a bare prop name would let React reuse
              // one block's field for the next block's same-named prop, so the
              // input would keep the previous block's uncommitted text.
              key={`${inspection.nodeId}:${prop.name}`}
              // A held field points at the reason in the card.
              reasonId={writable(prop.name) ? undefined : reasonId}
            >
              <BindableField
                nodeId={inspection.nodeId}
                prop={prop}
                blockLabel={inspection.label}
                binding={bindings?.[prop.name]}
                document={document}
                services={services}
                disabled={!writable(prop.name)}
                onApply={onApply}
              >
                <PropField
                  prop={prop}
                  disabled={!writable(prop.name)}
                  onCommit={onCommit}
                  services={services}
                  values={values}
                />
              </BindableField>
            </HeldByLock>
          ))
        );
        if (fields === undefined) {
          // Always a fragment under one key, so a note appearing or going
          // never remounts the field above it and its uncommitted text.
          return (
            <React.Fragment key={`${inspection.nodeId}:${prop.name}`}>
              {field}
              {note}
            </React.Fragment>
          );
        }
        // The switch sits OUTSIDE the lock's fieldset: a prop a lock holds is
        // still one a designer may try to expose, and the refusal that says
        // why is the answer they need, which a disabled switch would withhold.
        return (
          <div
            key={`${inspection.nodeId}:${prop.name}`}
            className="nx-inspector__prop"
          >
            {field}
            {note}
            <PropExposeControl
              binding={fields}
              nodeId={inspection.nodeId}
              prop={prop}
            />
          </div>
        );
      })}
    </div>
  );
}

function PropField({
  prop,
  disabled,
  onCommit,
  services,
  values,
}: {
  prop: EditableProp;
  disabled: boolean;
  onCommit: (name: string, value: unknown) => BlockDocument | null | void;
  services: ContentServices | undefined;
  /** The block's props as stored, for a control that reads another of them. */
  values: Readonly<Record<string, unknown>>;
}): React.JSX.Element {
  // Unique per mount, so two editors on one page never share a field id and a
  // label never points at the other editor's control.
  const id = React.useId();
  const Control = contentControlFor(prop.schema.type);

  if (Control === undefined) {
    return <UnsupportedField prop={prop} />;
  }

  return (
    <Control
      id={id}
      prop={prop}
      disabled={disabled}
      onCommit={onCommit}
      services={services}
      values={values}
    />
  );
}
