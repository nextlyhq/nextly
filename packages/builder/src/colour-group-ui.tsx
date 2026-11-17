"use client";

/**
 * The Colours tab's named groups as an author changes them: a group's name
 * renamed in place, its ⋯ menu ("Rename group", "Remove group"), "+ New
 * group", and dragging a colour onto a row or a group's heading.
 *
 * A new group holds no colour yet, and a group is the colours in it, so it
 * lives here, named, until a colour moves into it; from then on the colours
 * carry it. Every change writes only colours' display groups and the colour
 * order (`colour-groups`), never a code name, a value or the site's CSS.
 *
 * @module colour-group-ui
 */
import {
  MAX_TOKEN_LABEL_LENGTH,
  tokenLabelIssue,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Ellipsis, Plus } from "lucide-react";
import * as React from "react";

import {
  colourGroups,
  placeColour,
  removeColourGroup,
  renameColourGroup,
} from "./colour-groups";
import { useInPlaceField } from "./in-place-field";

/** What the Colours tab's groups share: the set, its writes, and the drafts. */
export interface ColourGroupHost {
  readonly tokens: SiteTokenSet;
  readonly readOnly: boolean;
  readonly commit: (next: SiteTokenSet) => void;
  /** Groups made with "+ New group" that no colour is in yet. */
  readonly pending: readonly string[];
  /** The group whose name is being edited in place. */
  readonly renaming: string | null;
  readonly setRenaming: (name: string | null) => void;
  readonly addPending: () => void;
  readonly renamePending: (from: string, to: string) => void;
  readonly dropPending: (name: string) => void;
  /** The colour being dragged, by identity. */
  readonly dragging: string | null;
  readonly setDragging: (identity: string | null) => void;
}

export const ColourGroupHostContext: React.Context<
  ColourGroupHost | undefined
> = React.createContext<ColourGroupHost | undefined>(undefined);

/** The name a new group starts with, unique among the groups there are. */
function newGroupName(taken: readonly string[]): string {
  const base = "New group";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${String(n)}`)) n += 1;
  return `${base} ${String(n)}`;
}

/** The Colours tab's shared state, for its sections and rows. */
export function useColourGroupHost(
  tokens: SiteTokenSet,
  readOnly: boolean,
  commit: (next: SiteTokenSet) => void
): ColourGroupHost {
  const [drafts, setDrafts] = React.useState<readonly string[]>([]);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const real = colourGroups(tokens).map(group => group.name);
  // A draft a colour has moved into is a group like any other now, so it is
  // let go, not just hidden: kept, it would come back empty once that group
  // is renamed or removed.
  const pending = drafts.filter(name => !real.includes(name));
  if (pending.length !== drafts.length) setDrafts(pending);
  return {
    tokens,
    readOnly,
    commit,
    pending,
    renaming,
    setRenaming,
    addPending: () => {
      const name = newGroupName([...real, ...pending]);
      setDrafts([...pending, name]);
      setRenaming(name);
    },
    renamePending: (from, to) =>
      setDrafts(pending.map(name => (name === from ? to : name))),
    dropPending: name => setDrafts(pending.filter(draft => draft !== name)),
    dragging,
    setDragging,
  };
}

/** The groups' names, real then drafts, as a colour may be moved into them. */
export function useColourGroupNames(): readonly string[] {
  const host = React.useContext(ColourGroupHostContext);
  if (host === undefined) return [];
  return [
    ...colourGroups(host.tokens).map(group => group.name),
    ...host.pending,
  ];
}

/** Where a drop lands a dragged colour: in a group, before a colour or last. */
function drop(
  host: ColourGroupHost,
  group: string,
  before: string | undefined
): void {
  const dragged = host.dragging;
  host.setDragging(null);
  if (dragged === null) return;
  const next = placeColour(host.tokens, dragged, group, before);
  if (next !== host.tokens) host.commit(next);
}

/** The group a colour is listed in. */
function groupOf(tokens: SiteTokenSet, identity: string): string | undefined {
  return colourGroups(tokens).find(group => group.identities.includes(identity))
    ?.name;
}

/**
 * A colour row's drag: it can be picked up, and a colour dropped on it lands
 * before it, in its group. Nothing where the colours are read-only.
 */
export function useColourRowDrag(row: {
  readonly identity: string;
  /** A colour's row is dragged; any other kind is not ordered. */
  readonly kind: string;
}): React.LiHTMLAttributes<HTMLLIElement> {
  const host = React.useContext(ColourGroupHostContext);
  const { identity } = row;
  if (row.kind !== "color" || host === undefined || host.readOnly) return {};
  return {
    draggable: true,
    onDragStart: event => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", identity);
      host.setDragging(identity);
    },
    onDragEnd: () => host.setDragging(null),
    onDragOver: event => {
      if (host.dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: event => {
      event.preventDefault();
      event.stopPropagation();
      const group = groupOf(host.tokens, identity);
      if (group !== undefined) drop(host, group, identity);
    },
  };
}

/** A group heading's drop: a colour dropped on it goes to the group's end. */
export function useColourGroupDrop(
  name: string
): React.HTMLAttributes<HTMLDivElement> {
  const host = React.useContext(ColourGroupHostContext);
  if (host === undefined || host.readOnly) return {};
  return {
    onDragOver: event => {
      if (host.dragging === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: event => {
      event.preventDefault();
      drop(host, name, undefined);
    },
  };
}

/**
 * A named group's heading: its name and count, or the field renaming it,
 * and its ⋯ menu.
 */
export function ColourGroupHead({
  name,
  children,
}: {
  name: string;
  /** The heading as the panel draws it: the fold toggle with the count. */
  children: React.ReactNode;
}): React.JSX.Element {
  const host = React.useContext(ColourGroupHostContext);
  if (host === undefined) return <>{children}</>;
  if (host.renaming === name) return <GroupNameField host={host} name={name} />;
  return (
    <>
      {children}
      {host.readOnly ? null : <GroupMenu host={host} name={name} />}
    </>
  );
}

/** The group's ⋯: "Rename group" and "Remove group". */
function GroupMenu({
  host,
  name,
}: {
  host: ColourGroupHost;
  name: string;
}): React.JSX.Element {
  const pending = host.pending.includes(name);
  const only = colourGroups(host.tokens).length < 2 && !pending;
  const renamed = React.useRef(false);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-vars__icon-button nx-vars__more nx-colour-group__more"
          aria-label={`More actions for group ${name}`}
        >
          <Ellipsis aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="nx-vars__menu"
        // The name field takes focus; the menu does not take it back.
        onCloseAutoFocus={event => {
          if (!renamed.current) return;
          renamed.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            renamed.current = true;
            host.setRenaming(name);
          }}
        >
          Rename group
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={only}
          onSelect={() => {
            if (pending) host.dropPending(name);
            else host.commit(removeColourGroup(host.tokens, name));
          }}
        >
          Remove group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The group's name in place: Enter or leaving keeps it, Escape keeps the old
 * one. An empty name, or one another group has, keeps the old one too.
 */
function GroupNameField({
  host,
  name,
}: {
  host: ColourGroupHost;
  name: string;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(name);
  const { field, done } = useInPlaceField();
  const finish = (keep: boolean): void => {
    if (done.current) return;
    done.current = true;
    host.setRenaming(null);
    const next = draft.trim();
    const taken = [
      ...colourGroups(host.tokens).map(group => group.name),
      ...host.pending,
    ].filter(other => other !== name);
    // A name the site could not store keeps the old one, as a taken one does.
    const refused = next === "" || tokenLabelIssue(next) !== undefined;
    if (!keep || refused || next === name || taken.includes(next)) return;
    if (host.pending.includes(name)) host.renamePending(name, next);
    else host.commit(renameColourGroup(host.tokens, name, next));
  };
  return (
    <input
      ref={field}
      className="nx-colour-group__name-field"
      aria-label="Group name"
      autoComplete="off"
      spellCheck={false}
      value={draft}
      maxLength={MAX_TOKEN_LABEL_LENGTH}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/**
 * "+ New group", at the end of the Colours tab, drawn as the add rows are:
 * the plus as an icon beside the words.
 */
export function NewGroupButton(): React.JSX.Element | null {
  const host = React.useContext(ColourGroupHostContext);
  if (host === undefined || host.readOnly) return null;
  return (
    <button
      type="button"
      className="nx-vars__add-row nx-colour-group__new"
      onClick={host.addPending}
    >
      <Plus aria-hidden="true" size={14} />
      New group
    </button>
  );
}
