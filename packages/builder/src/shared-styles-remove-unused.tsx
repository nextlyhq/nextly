/**
 * Removing the shared styles nothing uses: the head that offers it, how the
 * unused ones are found a page at a time, and the confirmation that removes
 * them.
 *
 * @module shared-styles-remove-unused
 */

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { EDITOR_WORDS } from "./editor-words";
import { KeepOrRemove, Refusal, useRefusableWrite } from "./panel-actions";
import { HoldReason, removeSharedStylesThrough } from "./shared-style-details";
import {
  isUnused,
  SHARED_STYLE_NOT_WHOLE_REMOVAL,
  SHARED_STYLE_RENAME_PENDING,
  SHARED_STYLE_UNCOUNTABLE_REMOVAL,
  SHARED_STYLE_UNCOUNTED_USES,
  SHARED_STYLES_WORD,
  type BlocksOnThisPage,
  type SharedStyleRow,
} from "./shared-style-library";
import type { FloorReason } from "./shared-styles-list";
import type { SharedStylesAccess } from "./shared-styles-types";
import { PAGE_SIZE } from "./shared-styles-types";

/**
 * Why "Remove unused…" waits, or `undefined` when it need not: while some
 * pages are still being counted, said first since it lasts longer, or while
 * a rename is stored, since a removal writes the whole list of styles too.
 */
function removeUnusedWait(
  reason: FloorReason,
  held: boolean
): string | undefined {
  if (reason === "counting") return SHARED_STYLE_NOT_WHOLE_REMOVAL;
  if (reason === "permanent") return SHARED_STYLE_UNCOUNTABLE_REMOVAL;
  return held ? SHARED_STYLE_RENAME_PENDING : undefined;
}

/** What "Remove unused…" found: still reading, a refusal, or the list. */
type UnusedRead =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "found"; readonly rows: readonly SharedStyleRow[] };

/**
 * The group's heading, with "Remove unused…": it reads the usage of every
 * style that could be removed, lists the unused ones by name, and removes
 * them only once the author confirms. Withheld while some pages are still
 * being counted, saying so in the route's words.
 */
export function RemoveUnusedHead({
  rows,
  offered,
  access,
  reason,
  held,
  saidInNote,
  blocksOf,
  onRemoved,
}: {
  rows: readonly SharedStyleRow[];
  /** False for a role that may not change the site's design. */
  offered: boolean;
  access: SharedStylesAccess | undefined;
  /** Why the counts are floors, which decides why removal waits. */
  reason: FloorReason;
  /** A rename is being stored, so a removal, which writes the whole list, waits. */
  held: boolean;
  /**
   * The tab's one counting note already says why it waits, under the same
   * id, so its own line is not drawn a second time.
   */
  saidInNote: boolean;
  blocksOf: (id: string) => BlocksOnThisPage;
  onRemoved: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // A locked style refuses removal, and one in code cannot be removed here.
  const candidates = rows.filter(row => !row.locked && !row.inCode);
  const shown = offered && access !== undefined && candidates.length > 0;
  const wait = removeUnusedWait(reason, held);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverAnchor asChild>
        <div className="nx-vars__group-head">
          <h3 className="nx-vars__group-name" id="nx-shared-styles-all">
            {EDITOR_WORDS.sharedStyles}
          </h3>
          {shown ? (
            <PopoverTrigger asChild>
              <button
                type="button"
                className="nx-vars__link nx-shared-styles__remove-unused"
                disabled={wait !== undefined}
                aria-describedby={
                  wait === undefined ? undefined : "nx-shared-styles-withheld"
                }
              >
                Remove unused&hellip;
              </button>
            </PopoverTrigger>
          ) : null}
        </div>
      </PopoverAnchor>
      {shown && wait !== undefined && !saidInNote ? (
        <p className="nx-shared-styles__meta" id="nx-shared-styles-withheld">
          {wait}
        </p>
      ) : null}
      {shown && access !== undefined ? (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor nx-shared-styles__editor"
          aria-label={`Remove unused ${SHARED_STYLES_WORD}`}
        >
          <RemoveUnused
            candidates={candidates}
            access={access}
            held={held}
            blocksOf={blocksOf}
            onDone={() => {
              setOpen(false);
              onRemoved();
            }}
            onKeep={() => setOpen(false)}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

/**
 * The styles nothing uses, from the usage of every candidate read fifty at a
 * time; a refusal in the route's words while some pages are still being
 * counted.
 */
async function findUnused(
  access: SharedStylesAccess,
  candidates: readonly SharedStyleRow[],
  blocksOf: (id: string) => BlocksOnThisPage,
  signal: AbortSignal
): Promise<UnusedRead> {
  const unused: SharedStyleRow[] = [];
  for (let at = 0; at < candidates.length; at += PAGE_SIZE) {
    const batch = candidates.slice(at, at + PAGE_SIZE);
    const answer = await access.usage(
      batch.map(row => row.id),
      signal
    );
    if (!answer.whole) {
      return { kind: "refused", reason: SHARED_STYLE_NOT_WHOLE_REMOVAL };
    }
    unused.push(
      ...batch.filter(row => {
        const reach = answer.styles.get(row.id);
        return reach !== undefined && isUnused(blocksOf(row.id), reach);
      })
    );
  }
  return { kind: "found", rows: unused };
}

/** "1 unused shared style", "3 unused shared styles". */
function unusedCount(count: number): string {
  return `${count} unused ${count === 1 ? "shared style" : SHARED_STYLES_WORD}`;
}

/** The unused styles, listed, and their removal once confirmed. */
function RemoveUnused({
  candidates,
  access,
  held,
  blocksOf,
  onDone,
  onKeep,
}: {
  candidates: readonly SharedStyleRow[];
  access: SharedStylesAccess;
  held: boolean;
  blocksOf: (id: string) => BlocksOnThisPage;
  onDone: () => void;
  onKeep: () => void;
}): React.JSX.Element {
  const [read, setRead] = React.useState<UnusedRead>({ kind: "reading" });
  // Read once per opening, from what stands when the author asks.
  const [asked] = React.useState(() => ({ candidates, blocksOf }));
  React.useEffect(() => {
    const controller = new AbortController();
    findUnused(access, asked.candidates, asked.blocksOf, controller.signal)
      .then(found => {
        if (!controller.signal.aborted) setRead(found);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRead({
          kind: "refused",
          reason: `Where these ${SHARED_STYLES_WORD} are used could not be read.`,
        });
      });
    return () => controller.abort();
  }, [access, asked]);

  if (read.kind !== "found") {
    return (
      <div className="nx-vars-editor__body">
        {read.kind === "refused" ? (
          <Refusal refusal={read.reason} />
        ) : (
          <p className="nx-shared-styles__meta" role="status">
            {`Finding unused ${SHARED_STYLES_WORD}…`}
          </p>
        )}
      </div>
    );
  }
  if (read.rows.length === 0) {
    return (
      <div className="nx-vars-editor__body">
        <p className="nx-shared-styles__meta" role="status">
          Every shared style here is in use.
        </p>
      </div>
    );
  }
  return (
    <ConfirmUnused
      rows={read.rows}
      access={access}
      held={held}
      onDone={onDone}
      onKeep={onKeep}
    />
  );
}

/** "50 were removed before the rest were refused." */
function removedBefore(count: number): string {
  return `${count} ${count === 1 ? "was" : "were"} removed before the rest were refused.`;
}

/**
 * The confirmation listing the unused styles, removed fifty at a time.
 *
 * Each batch the route stores is gone for good, so it leaves the list as it
 * lands: when a later batch is refused, the list holds only what is left, a
 * retry sends only that, and the dialog says how many went first.
 */
function ConfirmUnused({
  rows,
  access,
  held,
  onDone,
  onKeep,
}: {
  rows: readonly SharedStyleRow[];
  access: SharedStylesAccess;
  held: boolean;
  onDone: () => void;
  onKeep: () => void;
}): React.JSX.Element {
  const { busy, refusal, run } = useRefusableWrite();
  const [left, setLeft] = React.useState(rows);
  const [removed, setRemoved] = React.useState(0);
  const count = left.length;
  const remove = async (): Promise<void> => {
    let rest = left;
    while (rest.length > 0) {
      const batch = rest.slice(0, PAGE_SIZE);
      const write = async () =>
        (
          await removeSharedStylesThrough(
            access,
            batch.map(row => row.id)
          )
        )?.reason;
      if (!(await run(write))) return;
      rest = rest.slice(PAGE_SIZE);
      setLeft(rest);
      setRemoved(gone => gone + batch.length);
    }
    onDone();
  };
  return (
    <div
      className="nx-vars-editor__body nx-vars-editor__confirm"
      role="group"
      aria-label={`Remove ${unusedCount(count)}`}
    >
      <p>{`Remove ${unusedCount(count)}? No page uses them in the editor.`}</p>
      <p className="nx-shared-styles__meta">{SHARED_STYLE_UNCOUNTED_USES}</p>
      {/* Stacked, so a long name and its class both read in full. */}
      <ul className="nx-shared-styles__uses nx-shared-styles__uses--stacked">
        {left.map(row => (
          <li key={row.id}>
            <span className="nx-shared-styles__use-title">{row.name}</span>
            <span className="nx-shared-styles__class">{row.className}</span>
          </li>
        ))}
      </ul>
      {refusal !== null && removed > 0 ? (
        <p className="nx-shared-styles__meta">{removedBefore(removed)}</p>
      ) : null}
      <Refusal refusal={refusal} />
      <KeepOrRemove
        busy={busy}
        onKeep={onKeep}
        onRemove={() => void remove()}
        removeLabel={`Remove ${count}`}
        removeHeld={held}
        removeDescribedBy="nx-shared-styles-confirm-held"
      />
      <HoldReason held={held} id="nx-shared-styles-confirm-held" />
    </div>
  );
}
