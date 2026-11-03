"use client";

/**
 * What the Style tab edits, and the bar that chooses it.
 *
 * A style edit writes to the selected block unless the author has chosen one
 * of the shared styles it wears as the target. The choice is held here, per
 * block (selecting another block returns to "This block"), and handed both to
 * the bar, which shows and changes it, and to the style controls, which read
 * and write the target's values. One holder, so the bar and the controls can
 * never disagree about what an edit changes.
 *
 * The bar's own actions live here too: applying an existing shared style to a
 * block that wears none, "Save as shared style…" (the block verb every menu
 * offers), and each chip's Detach and Remove, all page edits through the
 * editor.
 *
 * @module style-target
 */

import type {
  NamedClass,
  NodeStyles,
  StyleState,
} from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import * as React from "react";

import type { CardVerbs } from "./block-card";
import { ClassSelector } from "./class-selector";
import { EditingBar, type EditTarget } from "./editing-bar";
import type { EditorState } from "./editor-state";
import { designReadOnlyReason, lockViewOf } from "./inspector";
import type { BuilderOp } from "./ops";
import {
  sharedStyleReachSentence,
  type SharedStyleReach,
  type SharedStyleRow,
} from "./shared-style-library";
import {
  nodeSharedStyles,
  planDetachSharedStyle,
  planRemoveSharedStyle,
  NO_DESIGN_RIGHT,
} from "./shared-style-target";
import type {
  PageClassBlocks,
  SharedStylesAccess,
} from "./shared-styles-panel";

/**
 * What the host lends the Style tab for shared styles.
 *
 * @experimental Settles with the shared-styles editor.
 */
export interface SharedStylesHost {
  /** Whether the author may change the site's design (`update-site-style`). */
  readonly mayChange: boolean;
  /**
   * Store a shared style's styles, whole. Resolves to the refusal in words,
   * or `undefined` once stored.
   */
  readonly writeStyles: (
    classId: string,
    styles: NodeStyles
  ) => Promise<string | undefined>;
  /** How widely styles are used across the site, for the target's reach. */
  readonly usage?: SharedStylesAccess["usage"];
  /** The blocks on the open page wearing each style. */
  readonly pageBlocks?: PageClassBlocks;
}

/**
 * What the style controls edit.
 *
 * `worn` is every shared style the block wears, so a control can say a value
 * comes from one, or that the block overrides one.
 */
export type StyleTarget =
  | { readonly kind: "block"; readonly worn: readonly SharedStyleRow[] }
  | {
      readonly kind: "shared";
      readonly worn: readonly SharedStyleRow[];
      readonly style: SharedStyleRow;
      /** Why its values can't be changed, when they can't. */
      readonly readOnly: string | undefined;
      /** Store its styles; resolves to the refusal, or nothing. */
      readonly write: (styles: NodeStyles) => Promise<string | undefined>;
    };

/** The words for a locked shared style's values. */
function lockedStyleReason(name: string): string {
  return `${name} is locked. Its properties can't be changed.`;
}

/** Nothing worn, as one value rather than a fresh array each render. */
const NONE: readonly SharedStyleRow[] = Object.freeze([]);

/**
 * The target for the selected block: the chosen shared style while the block
 * still wears it, else the block. Keyed by block, so the choice never travels
 * to the next selection.
 */
export function useStyleTarget(
  editor: EditorState,
  library: readonly NamedClass[] | undefined,
  host: SharedStylesHost | undefined
): {
  target: StyleTarget;
  choose: (id: string | null) => void;
} {
  const nodeId = editor.selectedId;
  const [chosen, setChosen] = React.useState<{
    nodeId: string;
    id: string;
  } | null>(null);
  const node =
    nodeId === null ? undefined : findNode(editor.document.nodes, nodeId);
  const worn =
    library === undefined || node === undefined
      ? NONE
      : nodeSharedStyles(library, node.classes ?? []);
  const choose = React.useCallback(
    (id: string | null) => {
      setChosen(id === null || nodeId === null ? null : { nodeId, id });
    },
    [nodeId]
  );
  const style =
    chosen !== null && chosen.nodeId === nodeId && host !== undefined
      ? worn.find(row => row.id === chosen.id)
      : undefined;
  if (style === undefined || host === undefined) {
    return { target: { kind: "block", worn }, choose };
  }
  return {
    target: {
      kind: "shared",
      worn,
      style,
      readOnly: !host.mayChange
        ? NO_DESIGN_RIGHT
        : style.locked
          ? lockedStyleReason(style.name)
          : undefined,
      write: styles => host.writeStyles(style.id, styles),
    },
    choose,
  };
}

/**
 * How widely a style reaches, in words, while it is the target: the blocks on
 * this page, then the documents the site's index counts. Read when the
 * target changes; "" until something is known.
 */
function useReachSentence(
  id: string | undefined,
  host: SharedStylesHost | undefined
): string {
  const usage = host?.usage;
  const [reach, setReach] = React.useState<{
    id: string;
    reach: SharedStyleReach;
  } | null>(null);
  React.useEffect(() => {
    if (id === undefined || usage === undefined) return;
    const controller = new AbortController();
    usage([id], controller.signal).then(
      answer => {
        const found = answer.styles.get(id);
        if (found !== undefined) setReach({ id, reach: found });
      },
      // A failed read leaves the reach unsaid rather than guessed: the page
      // count below still stands on its own.
      () => undefined
    );
    return () => controller.abort();
  }, [id, usage]);
  if (id === undefined) return "";
  const pageBlocks = host?.pageBlocks;
  const blocks =
    pageBlocks === undefined
      ? undefined
      : {
          count: pageBlocks.counts.get(id) ?? 0,
          complete: pageBlocks.complete,
        };
  return sharedStyleReachSentence(
    blocks,
    reach?.id === id ? reach.reach : undefined
  );
}

/** The bar's target, as it says it. */
function editTargetOf(target: StyleTarget, reach: string): EditTarget {
  if (target.kind === "block") return { kind: "block" };
  return {
    kind: "shared",
    id: target.style.id,
    name: target.style.name,
    className: target.style.className,
    reach,
  };
}

export interface StyleTargetBarProps {
  readonly editor: EditorState;
  readonly target: StyleTarget;
  readonly onChoose: (id: string | null) => void;
  readonly library: readonly NamedClass[] | undefined;
  readonly libraryAbsence?: "pending" | "failed";
  readonly host: SharedStylesHost | undefined;
  /** The shared block verbs, for "Save as shared style…". */
  readonly verbs: CardVerbs | undefined;
  readonly device: string;
  readonly state: StyleState;
  readonly stateControl?: React.ReactNode;
}

/** Apply the ops of a page edit, saying nothing when the store refuses. */
function applyPlan(
  editor: EditorState,
  plan: { ok: true; ops: BuilderOp[] } | { ok: false; reason: string }
): void {
  if (plan.ok) editor.applyAll(plan.ops);
}

/** The "what you're editing" bar, over the target this tab holds. */
export function StyleTargetBar({
  editor,
  target,
  onChoose,
  library,
  libraryAbsence,
  host,
  verbs,
  device,
  state,
  stateControl,
}: StyleTargetBarProps): React.JSX.Element {
  const nodeId = editor.selectedId;
  const reach = useReachSentence(
    target.kind === "shared" ? target.style.id : undefined,
    host
  );
  const held =
    nodeId === null
      ? undefined
      : designReadOnlyReason(editor.document, nodeId, lockViewOf(editor));
  const worn = target.worn;
  return (
    <EditingBar
      target={editTargetOf(target, reach)}
      chips={worn.map(row => ({ id: row.id, name: row.name }))}
      onTargetChange={host === undefined ? undefined : onChoose}
      onRemove={
        nodeId === null
          ? undefined
          : id =>
              applyPlan(
                editor,
                planRemoveSharedStyle(
                  editor.document,
                  nodeId,
                  id,
                  lockViewOf(editor)
                )
              )
      }
      onDetach={
        nodeId === null
          ? undefined
          : id => {
              const style = worn.find(row => row.id === id);
              if (style === undefined) return;
              applyPlan(
                editor,
                planDetachSharedStyle(
                  editor.document,
                  nodeId,
                  style,
                  lockViewOf(editor)
                )
              );
            }
      }
      chipActionsHeld={held}
      sharedReadOnly={target.kind === "shared" ? target.readOnly : undefined}
      actions={
        nodeId === null || worn.length > 0 || held !== undefined ? null : (
          <BarActions
            editor={editor}
            nodeId={nodeId}
            library={library}
            libraryAbsence={libraryAbsence}
            verbs={verbs}
          />
        )
      }
      device={device}
      state={state}
      stateControl={stateControl}
    />
  );
}

/**
 * What line one offers a block that wears no shared style: apply one the
 * site has, or save this block's look as a new one. One per block in the
 * first release, so neither shows once the block wears one.
 */
function BarActions({
  editor,
  nodeId,
  library,
  libraryAbsence,
  verbs,
}: {
  editor: EditorState;
  nodeId: string;
  library: readonly NamedClass[] | undefined;
  libraryAbsence: "pending" | "failed" | undefined;
  verbs: CardVerbs | undefined;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // The verb every menu runs, offered here only while it may run: a held
  // one says why in the block's ⋯ menu.
  const save = verbs?.actions.find(
    action => action.id === "save-as-shared-style" && action.enabled
  );
  const nodeClassIds = findNode(editor.document.nodes, nodeId)?.classes ?? [];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <button type="button" className="nx-editing-bar__action">
            Apply shared style
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="nx-vars-editor nx-shared-style-picker"
          aria-label="Apply shared style"
        >
          <ClassSelector
            key={nodeId}
            nodeId={nodeId}
            library={library}
            libraryAbsence={libraryAbsence}
            nodeClassIds={nodeClassIds}
            autoFocus
            onNodeClassesChange={classIds => {
              // Asked of the live document at the moment of the write.
              if (
                designReadOnlyReason(
                  editor.document,
                  nodeId,
                  lockViewOf(editor)
                ) !== undefined
              ) {
                return "refused";
              }
              const applied = editor.applyAll([
                { kind: "update", id: nodeId, patch: { classes: classIds } },
              ]);
              if (applied === null) return "refused";
              setOpen(false);
              return "applied";
            }}
          />
        </PopoverContent>
      </Popover>
      {save === undefined ? null : (
        <button
          type="button"
          className="nx-editing-bar__action"
          onClick={() => verbs?.run("save-as-shared-style")}
        >
          Save as shared style…
        </button>
      )}
    </>
  );
}
