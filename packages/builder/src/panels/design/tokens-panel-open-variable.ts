/**
 * Which variable's editor the Design panel has open, what opening, adding,
 * duplicating and closing one does, and each editor's commit, which settles
 * once the author's work on it has ended. Kept beside the panel that uses it,
 * in a file of its own so the panel stays within the size its folder allows.
 *
 * @module tokens-panel-open-variable
 */
import { tokenIdentity, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { inColourGroup } from "./colour-groups";
import { commitFocusedField } from "./editor-field-commit";
import {
  addVariable,
  duplicateVariable,
  labelNewVariable,
  type VariableEntry,
} from "./tokens-studio";
import type { OnAdd } from "./variable-adds";

/** An add, with the named group of colours whose list its add row ends. */
export type OnAddTo = (
  what: Parameters<OnAdd>[0],
  from: Parameters<OnAdd>[1],
  group?: string
) => void;

/**
 * Each editor's commit, settling where the author's work has already ended,
 * and a settle when the view goes away.
 *
 * Going away ends the author's work here as closing an editor does: a tab
 * change or the panel closing. An edit committed by an editor that is
 * already closed, such as a colour picker writing what it held as it
 * unmounts, comes after the settle its closing made, so it settles again
 * rather than wait for a pause the author has already ended.
 */
function useCommitsSettled(
  onChange: (tokens: SiteTokenSet) => void,
  onSettle: (() => void) | undefined,
  openKey: string | null
): (key: string) => (next: SiteTokenSet) => void {
  // The latest callback, so the effect runs only on unmount rather than on
  // every render that hands a new one.
  const settle = React.useRef(onSettle);
  settle.current = onSettle;
  // Which editor is open as of the latest render, and whether the panel is
  // still mounted: read when an editor commits, which it may do as it goes
  // away, after the close or the unmount has already settled.
  const openNow = React.useRef(openKey);
  openNow.current = openKey;
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      settle.current?.();
    };
  }, []);
  return key => next => {
    onChange(next);
    if (!mounted.current || openNow.current !== key) settle.current?.();
  };
}

/**
 * Which variable's editor is open, what opening and closing one does, and
 * each editor's commit, which settles once the editor has closed.
 *
 * A variable added from a "+" opens straight away, and is "fresh" until its
 * editor closes: nothing can reference it yet, so its code name may still
 * follow the name it was given, which happens on close. The row is keyed by
 * that code name, so focus is put back on it once it has re-rendered.
 */
export function useOpenVariable({
  tokens,
  onChange,
  currentTokens,
  onSettle,
}: {
  tokens: SiteTokenSet | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  /** The author is done with a variable; see `TokensPanelProps.onSettle`. */
  onSettle: (() => void) | undefined;
}): {
  /** The panel's element, which rows are found in to be focused. */
  root: React.RefObject<HTMLDivElement | null>;
  openKey: string | null;
  /** The row just added, while its editor is open; a search keeps it. */
  fresh: string | null;
  toggle: (key: string, open: boolean) => void;
  add: OnAddTo;
  duplicate: (entry: VariableEntry) => void;
  forget: (key: string) => void;
  /** Each row editor's commit; see {@link useCommitsSettled}. */
  commitFrom: (key: string) => (next: SiteTokenSet) => void;
  /** Focuses a row once it is drawn, as after a move to another group. */
  focus: (key: string) => void;
} {
  const root = React.useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const fresh = React.useRef(new Set<string>());
  const [freshOpen, setFreshOpen] = React.useState<string | null>(null);
  // What was pressed to add a variable: where focus goes back to when the
  // new row is not drawn once its editor closes, as under a search it does
  // not match.
  const origin = React.useRef<HTMLElement | null>(null);
  // Focus a row after its key changed under it (a just-added variable named
  // after its label) or after the editor closed onto a new row.
  React.useEffect(() => {
    if (focusKey === null) return;
    const find = (): HTMLElement | null | undefined =>
      root.current?.querySelector<HTMLElement>(
        `[data-variable-key="${CSS.escape(focusKey)}"]`
      );
    const row = find();
    if (row) {
      row.focus();
      // A row drawn anew, as one moved into another group is, has its button
      // replaced once just after it mounts, as its editor's anchor registers.
      // Focus follows the new one, unless it has gone elsewhere since.
      window.setTimeout(() => {
        const owner = row.ownerDocument;
        if (row.isConnected || owner.activeElement !== owner.body) return;
        find()?.focus();
      }, 0);
    } else if (origin.current?.isConnected === true) origin.current.focus();
    setFocusKey(null);
  }, [focusKey, tokens]);

  // A variable just added is brought into view before its editor is placed
  // beside it: added at the end of a long list, it would otherwise open its
  // editor below the window, far from the "+" pressed.
  React.useLayoutEffect(() => {
    if (openKey === null || !fresh.current.has(openKey)) return;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-variable-key="${CSS.escape(openKey)}"]`
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [openKey, tokens]);

  // A variable just made, new or a copy, opens; its code name follows its
  // name until the editor closes.
  const opened = (made: { tokens: SiteTokenSet; at: number }): void => {
    const added = made.tokens.tokens[made.at];
    if (added === undefined) return;
    onChange(made.tokens);
    const key = tokenIdentity(added);
    fresh.current.add(key);
    setFreshOpen(key);
    setOpenKey(key);
  };

  // The search is kept: the new row is added where the author is, in the
  // named group of colours its add row ends.
  const add: OnAddTo = (what, from, group) => {
    origin.current = from;
    const made = addVariable(currentTokens() ?? tokens, what);
    opened({ ...made, tokens: inColourGroup(made.tokens, made.at, group) });
  };

  const duplicate = (entry: VariableEntry): void => {
    const set = currentTokens() ?? tokens;
    if (set === undefined) return;
    origin.current = null;
    opened(duplicateVariable(set, entry.row.at, entry.label));
  };

  const close = (key: string): void => {
    // A field still being typed in commits first, as leaving it does: a
    // click outside closes the editor before the field's own blur, and the
    // name typed there would otherwise miss the code name made below.
    commitFocusedField(root.current?.ownerDocument);
    setOpenKey(null);
    setFreshOpen(null);
    // Settled after the renaming below, so a just-added variable's code name
    // is part of what is persisted with the rest of its edit.
    if (fresh.current.delete(key)) {
      const named = namedAfterLabel(currentTokens(), key);
      if (named !== undefined) onChange(named.tokens);
      // Its row once drawn again, or what added it where a search hides it.
      setFocusKey(named?.key ?? key);
    }
    onSettle?.();
  };

  const forget = (key: string): void => {
    fresh.current.delete(key);
    setOpenKey(null);
    setFreshOpen(null);
    onSettle?.();
  };

  const toggle = (key: string, open: boolean): void => {
    if (open) setOpenKey(key);
    else close(key);
  };

  const commitFrom = useCommitsSettled(onChange, onSettle, openKey);
  return {
    root,
    openKey,
    fresh: freshOpen,
    toggle,
    add,
    duplicate,
    forget,
    commitFrom,
    focus: setFocusKey,
  };
}

/**
 * A just-added variable given a code name made from the name the author gave
 * it, with the row key it now has; nothing when it has no name of its own or
 * the code name would not change.
 */
function namedAfterLabel(
  set: SiteTokenSet | undefined,
  key: string
): { tokens: SiteTokenSet; key: string } | undefined {
  if (set === undefined) return undefined;
  const at = set.tokens.findIndex(token => tokenIdentity(token) === key);
  const token = set.tokens[at];
  if (token?.label === undefined) return undefined;
  const named = labelNewVariable(set, at, token.label);
  const renamed = named.tokens[at];
  if (renamed === undefined || renamed.name === token.name) return undefined;
  return { tokens: named, key: tokenIdentity(renamed) };
}
