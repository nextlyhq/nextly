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
  BreakpointSet,
  NamedClass,
  NodeStyles,
  SiteTokenSet,
  StyleState,
  TokenMode,
} from "@nextlyhq/blocks-engine";
import { findNode, getBlock } from "@nextlyhq/blocks-engine";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import * as React from "react";

import type { CardVerbs } from "./block-card";
import { useSurvivingReport } from "./builder-notices";
import { ClassSelector } from "./class-selector";
import { EditingBar, type EditTarget } from "./editing-bar";
import type { EditorState } from "./editor-state";
import { designReadOnlyReason, lockViewOf } from "./inspector";
import { lookLineWords, looksOfType, wornLook } from "./look-tiles";
import { LookTiles } from "./look-tiles-view";
import type { BuilderOp } from "./op-vocabulary";
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
  type SharedStyleChange,
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
   * Apply one change to a shared style's styles and store them. The host
   * applies it to the styles as they stand after every write it has queued,
   * so two edits made before the first is stored both survive. Resolves to the
   * refusal in words, or `undefined` once stored (or when nothing changed).
   */
  readonly writeStyles: (
    classId: string,
    change: SharedStyleChange
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
      /** Apply a change to its styles and store it; resolves to the refusal, or nothing. */
      readonly write: (
        change: SharedStyleChange
      ) => Promise<string | undefined>;
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
  /**
   * Why the selected block's design is held, or `undefined`: the one
   * reading the target falls back on and the bar holds its chips by, so
   * what an author may choose and where an edit goes cannot disagree.
   */
  held: string | undefined;
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
  // A block whose design is held (locked, or inside contentOnly) keeps the
  // block as the target: its shared style's values are its design here, and
  // editing them from this block would change that design all the same. A
  // choice made before the hold landed falls back with it.
  const held =
    nodeId === null
      ? undefined
      : designReadOnlyReason(editor.document, nodeId, lockViewOf(editor));
  const read =
    chosen !== null &&
    chosen.nodeId === nodeId &&
    host !== undefined &&
    held === undefined
      ? worn.find(row => row.id === chosen.id)
      : undefined;
  const queued = useQueuedStyles(read, host);
  if (read === undefined || host === undefined || queued === undefined) {
    return { target: { kind: "block", worn }, choose, held };
  }
  return {
    target: {
      kind: "shared",
      worn,
      style: queued.style,
      readOnly: !host.mayChange
        ? NO_DESIGN_RIGHT
        : read.locked
          ? lockedStyleReason(read.name)
          : undefined,
      write: queued.write,
    },
    choose,
    held,
  };
}

/**
 * The target for a look edited on its own, with no block selected: the look,
 * read and written as a shared style is, its edits queued the same way.
 * `undefined` while there is no look, or no host to store it.
 *
 * @experimental Settles with the Design panel's Block looks group.
 */
export function useLookTarget(
  look: SharedStyleRow | undefined,
  host: SharedStylesHost | undefined
): StyleTarget | undefined {
  const queued = useQueuedStyles(look, host);
  if (look === undefined || host === undefined || queued === undefined) {
    return undefined;
  }
  return {
    kind: "shared",
    worn: NONE,
    style: queued.style,
    readOnly: !host.mayChange
      ? NO_DESIGN_RIGHT
      : look.locked
        ? lockedStyleReason(look.name)
        : undefined,
    write: queued.write,
  };
}

/**
 * The target's styles as the edits queued since the last read leave them,
 * and the write that queues one.
 *
 * Every write still goes to the host as an address-level change, which the
 * host applies to what it has queued and judges unchanged or not there. The
 * controls show the edits on their way, so a value changed and changed back
 * before the first is read back is a change to the field (and so a write)
 * rather than a match with the stale read. A new read replaces them. A
 * refused edit stays shown, with its refusal beside the field, as a refused
 * block edit keeps the author's draft, until the next read.
 */
function useQueuedStyles(
  read: SharedStyleRow | undefined,
  host: SharedStylesHost | undefined
):
  | {
      style: SharedStyleRow;
      write: (change: SharedStyleChange) => Promise<string | undefined>;
    }
  | undefined {
  const [queued, setQueued] = React.useState<{
    id: string;
    over: NodeStyles;
    styles: NodeStyles;
  } | null>(null);
  const write = React.useCallback(
    (change: SharedStyleChange): Promise<string | undefined> => {
      if (read === undefined || host === undefined) {
        return Promise.resolve("This shared style is no longer the target.");
      }
      setQueued(current => {
        const base =
          current !== null &&
          current.id === read.id &&
          current.over === read.styles
            ? current.styles
            : read.styles;
        const next = change(base);
        return next.kind === "write"
          ? { id: read.id, over: read.styles, styles: next.styles }
          : current;
      });
      return host.writeStyles(read.id, change);
    },
    [read, host]
  );
  if (read === undefined) return undefined;
  // Only while the read they were made over is still the read in hand.
  const showing =
    queued !== null && queued.id === read.id && queued.over === read.styles
      ? { ...read, styles: queued.styles }
      : read;
  return { style: showing, write };
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
  /** Why the block's design is held, as {@link useStyleTarget} read it. */
  readonly held: string | undefined;
  readonly library: readonly NamedClass[] | undefined;
  /** The site's tokens, for drawing the look tiles as the canvas shows them. */
  readonly tokens?: SiteTokenSet;
  /** The mode the selected block is drawn in, which the tiles draw in. */
  readonly tokenMode: TokenMode;
  readonly libraryAbsence?: "pending" | "failed";
  readonly host: SharedStylesHost | undefined;
  /** The shared block verbs, for "Save as shared style…". */
  readonly verbs: CardVerbs | undefined;
  readonly device: string;
  /** The site's breakpoints, so Detach weighs a later style's narrower values. */
  readonly breakpoints?: BreakpointSet;
  readonly state: StyleState;
  readonly stateControl?: React.ReactNode;
}

/**
 * Apply the ops of a chip's page edit, or say why not: the plan's refusal
 * (the block's lock), or the page refusing the change (its limits). Said
 * through the shell, since the menu that asked has closed.
 */
function applyPlan(
  editor: EditorState,
  plan: { ok: true; ops: BuilderOp[] } | { ok: false; reason: string },
  refusedWords: string,
  report: (reason: string) => void
): void {
  if (!plan.ok) {
    report(plan.reason);
    return;
  }
  if (editor.applyAll(plan.ops) === null) report(refusedWords);
}

/**
 * Each chip's menu actions, page edits through the editor: take the style off
 * the block, or detach it (the block keeps the look the worn styles give it).
 * None without a selected block.
 */
function chipActions(
  editor: EditorState,
  nodeId: string | null,
  worn: readonly SharedStyleRow[],
  report: (reason: string) => void,
  breakpoints: BreakpointSet | undefined
): {
  onRemove?: (id: string) => void;
  onDetach?: (id: string) => void;
  detachHeld?: (id: string) => string | undefined;
} {
  if (nodeId === null) return {};
  return {
    onRemove: id =>
      applyPlan(
        editor,
        planRemoveSharedStyle(editor.document, nodeId, id, lockViewOf(editor)),
        `${nameOf(worn, id)} could not be taken off this block: the page could not take the change.`,
        report
      ),
    onDetach: id => {
      const plan = detachPlan(id);
      if (plan === undefined) return;
      applyPlan(
        editor,
        plan,
        `${nameOf(worn, id)} could not be detached from this block: the page could not take the change.`,
        report
      );
    },
    // The same plan, read before the click, so a refusal holds the item.
    detachHeld: id => {
      const plan = detachPlan(id);
      return plan === undefined || plan.ok ? undefined : plan.reason;
    },
  };
  function detachPlan(id: string) {
    const style = worn.find(row => row.id === id);
    if (style === undefined || nodeId === null) return undefined;
    return planDetachSharedStyle(
      editor.document,
      nodeId,
      style,
      worn,
      lockViewOf(editor),
      breakpoints
    );
  }
}

/** A worn style's name by its id, for words about it. */
function nameOf(worn: readonly SharedStyleRow[], id: string): string {
  return worn.find(row => row.id === id)?.name ?? "This shared style";
}

/** The "what you're editing" bar, over the target this tab holds. */
export function StyleTargetBar({
  editor,
  target,
  onChoose,
  held,
  library,
  libraryAbsence,
  host,
  verbs,
  device,
  breakpoints,
  state,
  stateControl,
  tokens,
  tokenMode,
}: StyleTargetBarProps): React.JSX.Element {
  const nodeId = editor.selectedId;
  // The bar has no line of its own for a refusal, so it speaks through the
  // shell's notices, which outlive the menu that asked.
  const survive = useSurvivingReport();
  const report = (reason: string): void => survive(reason, () => false);
  const reach = useReachSentence(
    target.kind === "shared" ? target.style.id : undefined,
    host
  );
  const worn = target.worn;
  return (
    <>
      <LookTiles
        editor={editor}
        library={library}
        held={held}
        tokens={tokens}
        mode={tokenMode}
        onRefused={report}
      />
      <EditingBar
        target={editTargetOf(target, reach)}
        chips={worn.map(row => ({
          id: row.id,
          name: row.name,
          className: row.className,
          locked: row.locked,
        }))}
        onTargetChange={host === undefined ? undefined : onChoose}
        {...chipActions(editor, nodeId, worn, report, breakpoints)}
        {...wornLookLine(editor, nodeId, worn, library)}
        chipActionsHeld={held}
        // The shared chips too: choosing one would edit the held design.
        targetHeld={held}
        sharedReadOnly={target.kind === "shared" ? target.readOnly : undefined}
        actions={offeredActions({
          editor,
          nodeId,
          worn,
          held,
          library,
          libraryAbsence,
          verbs,
        })}
        device={device}
        state={state}
        stateControl={stateControl}
      />
    </>
  );
}

/**
 * The bar's line about the look the block wears, if it wears one: that an
 * edit here changes this block only, and how to change the look everywhere.
 */
function wornLookLine(
  editor: EditorState,
  nodeId: string | null,
  worn: readonly SharedStyleRow[],
  library: readonly NamedClass[] | undefined
): { wornLook?: { id: string; here: string; everywhere: string } } {
  const node =
    nodeId === null ? undefined : findNode(editor.document.nodes, nodeId);
  if (node === undefined || library === undefined) return {};
  // The look the canvas applies, as the tiles read it: one answer for both.
  const id = wornLook(node.classes, looksOfType(library, node.type));
  const look = worn.find(row => row.id === id);
  if (look === undefined) return {};
  const label = getBlock(node.type)?.editor?.label ?? "block";
  return {
    wornLook: {
      id: look.id,
      ...lookLineWords(look.name, label),
    },
  };
}

/**
 * Line one's actions, or none: only for a block that wears no shared style
 * and whose design isn't held. A look is worn beside a shared style, so
 * "Apply" and "Save as" stay on offer while the block wears only a look.
 */
function offeredActions({
  editor,
  nodeId,
  worn,
  held,
  library,
  libraryAbsence,
  verbs,
}: {
  editor: EditorState;
  nodeId: string | null;
  worn: readonly SharedStyleRow[];
  held: string | undefined;
  library: readonly NamedClass[] | undefined;
  libraryAbsence: "pending" | "failed" | undefined;
  verbs: CardVerbs | undefined;
}): React.JSX.Element | null {
  const wearsSharedStyle = worn.some(row => row.look !== true);
  if (nodeId === null || wearsSharedStyle || held !== undefined) return null;
  return (
    <BarActions
      editor={editor}
      nodeId={nodeId}
      library={library}
      libraryAbsence={libraryAbsence}
      verbs={verbs}
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
          // Kept clear of the window's edge.
          collisionPadding={8}
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
