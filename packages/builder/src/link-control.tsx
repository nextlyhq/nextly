"use client";

/**
 * The Content tab's link: one control for where a block goes, and the two
 * settings that only mean something once it goes somewhere.
 *
 * - **The link** is a combobox. Empty, it reads "Search pages or paste a
 *   URL". Open, it searches the site's pages and other collections' entries
 *   through the host's `findLinkTargets` and offers what was typed as an
 *   address. Set, it is a chip naming the page, the entry or the address,
 *   with ✕ to clear it.
 * - **Open in new tab** is a switch row, and **Link options** a disclosure of
 *   `rel` checkboxes. Both are drawn only while a link is set.
 *
 * Which props make up the link, and what each change writes, are decided in
 * `link-group`; this module draws them. Every change is ONE write of the
 * props it touches, through `onCommitMany`, so a pick that sets an entry and
 * clears an address is one step to undo.
 *
 * Without the host's search, the control takes typed addresses only, and
 * says so in the list.
 *
 * @module link-control
 */

import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import {
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@nextlyhq/ui";
import {
  ChevronRight,
  CornerDownLeft,
  FileText,
  Hash,
  Link2,
  Mail,
  Phone,
  Search,
  X,
} from "lucide-react";
import * as React from "react";

import type { ContentServices, LinkTarget } from "./content-controls";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import {
  lockViewOf,
  propIsWritable,
  propLabel,
  type EditableProp,
} from "./inspector";
import {
  addressFor,
  clearChanges,
  linkKindOf,
  linkValueOf,
  pickChanges,
  REL_FLAGS,
  relHas,
  relOthers,
  relTokens,
  relWith,
  withChanges,
  type LinkChanges,
  type LinkGroup,
  type LinkKind,
  type LinkPick,
  type LinkValue,
} from "./link-group";
import type { BindableOptions, BindableWrapper } from "./prop-groups";

/** How long typing pauses before the host is asked again. */
const SEARCH_PAUSE_MS = 150;

/** How many pages and entries one search lists. */
const TARGETS_SHOWN = 10;

/**
 * How many a lookup of the stored link reads: the host's most, so a page
 * named by its address is found among as many as one read can return.
 */
const LOOKUP_LIMIT = 20;

type FindLinkTargets = NonNullable<ContentServices["findLinkTargets"]>;

/**
 * Write the props `changes` names on one block, as one edit, or none of them.
 *
 * Every prop is asked whether it may change where the block sits, as a single
 * prop's commit asks, and one that may not refuses the whole edit. A pick
 * changes a destination across props (an address and the entry reference it
 * replaces), and writing only the ones a `contentOnly` area allows would leave
 * a destination half saved. The group asks first and sends only what may
 * change; this holds the rule for whatever calls it.
 *
 * @returns the document after the edit, or `null` when it was not applied
 */
export function commitLinkChanges(
  editor: EditorState,
  nodeId: string,
  changes: LinkChanges
): BlockDocument | null {
  const document = editor.document;
  const view = lockViewOf(editor);
  const names = Object.keys(changes);
  if (names.length === 0) return null;
  if (!names.every(name => propIsWritable(document, nodeId, name, view))) {
    return null;
  }
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return null;
  return editor.apply({
    kind: "update",
    id: nodeId,
    patch: { props: withChanges(node.props, changes) },
  });
}

/** The pages and entries for what is typed, while the list is open. */
type Targets =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "found"; readonly targets: readonly LinkTarget[] }
  | { readonly kind: "failed" };

/**
 * Read the targets for `search` while `active`, a pause after the last key,
 * cancelling a read a newer one replaces so a slow answer cannot overwrite a
 * later one.
 */
function useTargets(
  find: FindLinkTargets | undefined,
  search: string,
  active: boolean
): Targets {
  const [targets, setTargets] = React.useState<Targets>({ kind: "idle" });
  React.useEffect(() => {
    if (!active || find === undefined) return;
    const controller = new AbortController();
    setTargets({ kind: "loading" });
    const timer = setTimeout(() => {
      find({
        search: search.trim(),
        limit: TARGETS_SHOWN,
        signal: controller.signal,
      }).then(
        found => {
          if (!controller.signal.aborted) {
            setTargets({ kind: "found", targets: found });
          }
        },
        () => {
          if (!controller.signal.aborted) setTargets({ kind: "failed" });
        }
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [find, search, active]);
  return targets;
}

/** The words a path's last part reads as: `/blog/spring-sale` is "spring sale". */
function searchWordsOf(path: string): string {
  const last = path.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/[-_]+/g, " ").trim();
}

/** A key naming one stored link, so a lookup is made once per link. */
function linkKey(value: LinkValue): string | undefined {
  if (value.kind === "entry") return `entry:${value.collection}:${value.id}`;
  if (value.kind === "address" && linkKindOf(value.href) === "path") {
    return `path:${value.href}`;
  }
  return undefined;
}

/**
 * What is known of the page or entry a stored link names.
 *
 * - `none`: nothing can be looked up, because the link is a typed address,
 *   or because the host lends no search to look it up with.
 * - `loading`, then `found` or `missing`: the lookup ran, and either named it
 *   or found nothing the author can open.
 * - `failed`: the lookup itself failed, which says nothing about the entry,
 *   so it is kept apart from `missing` and tried again.
 */
type StoredLookup =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "found"; readonly target: LinkTarget }
  | { readonly kind: "missing" }
  | { readonly kind: "failed" };

/**
 * The page or entry the stored link names, looked up once per link: an entry
 * by its collection and id, and a path by its address, first among the pages
 * whose title reads like its last part, then among the first pages listed,
 * since a slug need not read like its page's title.
 *
 * A failed lookup is not repeated on its own, so a host that is down is not
 * asked again on every render. `retry` asks again, once, after a failure: the
 * control calls it when the author comes back to the link.
 */
function useStoredTarget(
  find: FindLinkTargets | undefined,
  value: LinkValue
): { lookup: StoredLookup; retry: () => void } {
  const key = linkKey(value);
  const [found, setFound] = React.useState<{
    key: string;
    lookup: StoredLookup;
  }>();
  // Bumped by `retry`, so the effect below runs again for the same link.
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (key === undefined || find === undefined) return;
    const controller = new AbortController();
    const [kind, ...rest] = key.split(":");
    const matches = (target: LinkTarget): boolean =>
      kind === "entry"
        ? `${target.collection}:${target.id}` === rest.join(":")
        : target.path === rest.join(":");
    const settle = (lookup: StoredLookup): void => {
      if (!controller.signal.aborted) setFound({ key, lookup });
    };
    const words = kind === "entry" ? "" : searchWordsOf(rest.join(":"));
    const searches = words === "" ? [""] : [words, ""];
    const lookUp = async (): Promise<LinkTarget | null> => {
      for (const search of searches) {
        const targets = await find({
          search,
          limit: LOOKUP_LIMIT,
          signal: controller.signal,
        });
        const match = targets.find(matches);
        if (match !== undefined) return match;
      }
      return null;
    };
    lookUp().then(
      target =>
        settle(
          target === null ? { kind: "missing" } : { kind: "found", target }
        ),
      () => settle({ kind: "failed" })
    );
    return () => controller.abort();
  }, [find, key, attempt]);
  const lookup: StoredLookup =
    key === undefined || find === undefined
      ? { kind: "none" }
      : found === undefined || found.key !== key
        ? { kind: "loading" }
        : found.lookup;
  const retry = (): void => {
    if (lookup.kind !== "failed") return;
    // Shown as loading while it is asked again, and read again only once.
    setFound(undefined);
    setAttempt(at => at + 1);
  };
  return { lookup, retry };
}

/** One row of the open list. */
type LinkOption =
  | {
      readonly key: string;
      readonly kind: "target";
      readonly target: LinkTarget;
      /** Why it cannot be chosen here, when it cannot. */
      readonly unusable?: string;
    }
  | { readonly key: string; readonly kind: "address"; readonly href: string };

/** Said of a page this block could only link to by an address it lacks. */
const NO_ADDRESS = "No address known for this page";

/**
 * The open list's rows, in the order they are drawn and stepped through.
 *
 * Text that reads as an address (`https://…`, `/…`, `mailto:`, `tel:`, `#…`)
 * puts "Use as a URL" first, so Enter takes what was pasted; otherwise the
 * pages and entries come first and the address after them.
 */
function optionsFor(
  typed: string,
  targets: Targets,
  entryLinks: boolean
): LinkOption[] {
  const href = addressFor(typed);
  const address: LinkOption[] =
    href === undefined ? [] : [{ key: "address", kind: "address", href }];
  const found: LinkOption[] =
    targets.kind === "found"
      ? targets.targets.map(target => ({
          key: `target:${target.collection}:${target.id}`,
          kind: "target",
          target,
          // A block with an entry reference links to any entry by it; any
          // other block needs the address the page is served at.
          ...(target.path === undefined && !entryLinks
            ? { unusable: NO_ADDRESS }
            : {}),
        }))
      : [];
  return linkKindOf(typed) === undefined
    ? [...found, ...address]
    : [...address, ...found];
}

/** What a chosen row writes. */
function pickOf(option: LinkOption): LinkPick {
  if (option.kind === "address") return { kind: "address", href: option.href };
  const { target } = option;
  return target.path === undefined
    ? { kind: "entry", collection: target.collection, id: target.id }
    : { kind: "address", href: target.path };
}

/** The icon an address is drawn with. */
function AddressIcon({ kind }: { kind: LinkKind }): React.JSX.Element {
  const Icon =
    kind === "mail"
      ? Mail
      : kind === "phone"
        ? Phone
        : kind === "anchor"
          ? Hash
          : Link2;
  return <Icon aria-hidden="true" size={14} className="nx-link-pick__icon" />;
}

/** What the chip says about the stored link. */
interface ChipWords {
  readonly page: boolean;
  readonly kind: LinkKind;
  readonly title: string;
  readonly detail?: string;
}

/** The stored entry reference in words, from what is known of it. */
function entryWords(
  value: { readonly collection: string; readonly id: string },
  lookup: StoredLookup
): ChipWords {
  const as = (title: string, detail: string): ChipWords => ({
    page: true,
    kind: "web",
    title,
    detail,
  });
  switch (lookup.kind) {
    case "found":
      return as(lookup.target.title, lookup.target.group);
    case "loading":
      return { page: true, kind: "web", title: "Loading the linked entry…" };
    case "missing":
      return as("An entry you can't open here", value.collection);
    case "failed":
      return as("The linked entry couldn't be loaded", value.collection);
    case "none":
      // No search to name it with: the reference as it is stored, which
      // still says where the link goes and can still be cleared.
      return as(`An entry in ${value.collection}`, value.id);
  }
}

/** The stored link in words, from what is known of it. */
function chipWords(
  value: LinkValue,
  lookup: StoredLookup
): ChipWords | undefined {
  if (value.kind === "none") return undefined;
  if (value.kind === "entry") return entryWords(value, lookup);
  if (lookup.kind === "found") {
    return {
      page: true,
      kind: "path",
      title: lookup.target.title,
      detail: value.href,
    };
  }
  // An address that names no page the author can open, or that could not be
  // looked up, is shown as itself.
  return {
    page: false,
    kind: linkKindOf(value.href) ?? "web",
    title: value.href,
  };
}

/** The key a pick's link is looked up and remembered by. */
function pickKey(pick: LinkPick): string | undefined {
  return linkKey(
    pick.kind === "entry"
      ? { kind: "entry", collection: pick.collection, id: pick.id }
      : { kind: "address", href: pick.href }
  );
}

/** What the trigger is announced as: the link it holds, or what it does. */
function triggerLabel(label: string, words: ChipWords | undefined): string {
  if (words === undefined) return `${label}: search pages or paste a URL`;
  const detail = words.detail === undefined ? "" : `, ${words.detail}`;
  return `${label}: ${words.title}${detail}. Change`;
}

/** What the trigger draws: the placeholder, or the chosen link's icon, title and address. */
function TriggerContent({
  words,
}: {
  words: ChipWords | undefined;
}): React.JSX.Element {
  if (words === undefined) {
    return (
      <>
        <Link2 aria-hidden="true" size={14} className="nx-link-pick__icon" />
        <span
          className="nx-link-pick__placeholder"
          // Short enough for the control column; the search field it opens
          // says it in full.
          title="Search pages or paste a URL"
        >
          Search or paste a URL
        </span>
      </>
    );
  }
  return (
    <>
      {words.page ? (
        <FileText aria-hidden="true" size={14} className="nx-link-pick__icon" />
      ) : (
        <AddressIcon kind={words.kind} />
      )}
      <span className="nx-link-pick__title" title={words.title}>
        {words.title}
      </span>
      {words.detail === undefined ? null : (
        <span className="nx-link-pick__detail" title={words.detail}>
          {words.detail}
        </span>
      )}
    </>
  );
}

/**
 * What the chip says about the stored link: the last row chosen here, so it
 * names it at once rather than after a lookup of what was just picked, and
 * otherwise what a lookup of the stored link found.
 */
function useChipWords(
  find: FindLinkTargets | undefined,
  value: LinkValue
): {
  words: ChipWords | undefined;
  remember: (key: string | undefined, target: LinkTarget) => void;
  retry: () => void;
} {
  const [picked, setPicked] = React.useState<{
    key: string | undefined;
    target: LinkTarget;
  } | null>(null);
  // Only a page or an entry has a key; a typed address is shown as itself.
  const key = linkKey(value);
  const pickedHere =
    picked !== null && picked.key !== undefined && picked.key === key
      ? picked.target
      : undefined;
  const { lookup, retry } = useStoredTarget(
    pickedHere === undefined ? find : undefined,
    value
  );
  return {
    words: chipWords(
      value,
      pickedHere === undefined ? lookup : { kind: "found", target: pickedHere }
    ),
    remember: (at, target) => setPicked({ key: at, target }),
    retry,
  };
}

interface LinkControlProps {
  /** The trigger's id, which the row's label points at. */
  readonly id: string;
  /** What the row is called: the link prop's own label. */
  readonly label: string;
  readonly value: LinkValue;
  /** Whether a page without an address can be linked as an entry reference. */
  readonly entryLinks: boolean;
  readonly disabled: boolean;
  readonly find: FindLinkTargets | undefined;
  readonly onPick: (pick: LinkPick) => void;
  readonly onClear: () => void;
  /**
   * Whether there is a stored link to clear. A link that applies only as the
   * block's default has nothing stored, so clearing it would change nothing.
   */
  readonly clearable: boolean;
}

/** The link combobox: an empty trigger or the chosen link's chip, and the list. */
function LinkControl({
  id,
  label,
  value,
  entryLinks,
  disabled,
  find,
  onPick,
  onClear,
  clearable,
}: LinkControlProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const { words, remember, retry } = useChipWords(find, value);

  const openWith = (next: boolean): void => {
    // Opened on a typed address, the field starts from it, so a typo is
    // fixed rather than typed again; on a page or an entry it starts empty.
    // A lookup of the stored link that failed is tried again as it opens.
    if (next) {
      retry();
      setTyped(
        value.kind === "address" && words?.page !== true ? value.href : ""
      );
    }
    setOpen(next);
  };

  const choose = (option: LinkOption): void => {
    const pick = pickOf(option);
    if (option.kind === "target") remember(pickKey(pick), option.target);
    setOpen(false);
    onPick(pick);
  };

  return (
    <Popover open={open} onOpenChange={openWith} modal={false}>
      <PopoverAnchor asChild>
        <div
          className="nx-link-pick"
          data-set={words === undefined ? undefined : ""}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id}
              className="nx-link-pick__trigger"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={triggerLabel(label, words)}
              // Coming back to a link whose lookup failed asks again, once.
              onFocus={retry}
              onKeyDown={event => {
                // Down opens the list, as on any combobox.
                if (event.key === "ArrowDown" && !open) {
                  event.preventDefault();
                  openWith(true);
                }
              }}
            >
              <TriggerContent words={words} />
            </button>
          </PopoverTrigger>
          {words === undefined || !clearable ? null : (
            <button
              type="button"
              className="nx-link-pick__clear"
              disabled={disabled}
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={onClear}
            >
              <X aria-hidden="true" size={14} />
            </button>
          )}
        </div>
      </PopoverAnchor>
      {/* Aligned to the control's right edge: the list is wider than the
          control column, and the inspector sits at the window's right edge. */}
      <PopoverContent
        align="end"
        sideOffset={4}
        className="nx-link-pick__popover"
      >
        <LinkList
          label={label}
          typed={typed}
          onType={setTyped}
          find={find}
          entryLinks={entryLinks}
          onChoose={choose}
        />
      </PopoverContent>
    </Popover>
  );
}

/** One collection's rows, under its heading. */
interface OptionGroup {
  /** The collection's slug, which tells two collections apart. */
  readonly key: string;
  /** Its heading: the collection's name, which two collections may share. */
  readonly name: string;
  readonly options: LinkOption[];
}

/**
 * The pages and entries by collection, in the order the host listed them:
 * the site's own pages first.
 */
function groupsOf(options: readonly LinkOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  for (const option of options) {
    if (option.kind !== "target") continue;
    const key = option.target.collection;
    const group = groups.find(each => each.key === key);
    if (group === undefined) {
      groups.push({ key, name: option.target.group, options: [option] });
    } else {
      group.options.push(option);
    }
  }
  return groups;
}

/** What the list says about the search, when it has something to say. */
function listStatus(
  find: FindLinkTargets | undefined,
  targets: Targets,
  typed: string,
  listed: boolean
): string | undefined {
  if (find === undefined) return "Type or paste an address.";
  if (targets.kind === "loading") return listed ? undefined : "Searching…";
  if (targets.kind === "failed") {
    return "Pages couldn't be searched. Try again in a moment.";
  }
  if (targets.kind !== "found" || targets.targets.length > 0) return undefined;
  return typed.trim() === ""
    ? "No pages yet. Type or paste an address."
    : "No pages match.";
}

/** Where an arrow key moves the active row, or `undefined` for any other key. */
function stepFrom(key: string, at: number, last: number): number | undefined {
  if (key === "ArrowDown") return Math.min(at + 1, last);
  if (key === "ArrowUp") return Math.max(at - 1, 0);
  return undefined;
}

/** A row's words: "Use … as a URL", or a page's title and its address or the reason it can't be used. */
function OptionWords({ option }: { option: LinkOption }): React.JSX.Element {
  if (option.kind === "address") {
    return (
      <>
        <AddressIcon kind={linkKindOf(option.href) ?? "web"} />
        <span className="nx-link-pick__option-title">
          Use &ldquo;{option.href}&rdquo; as a URL
        </span>
      </>
    );
  }
  const detail = option.unusable ?? option.target.path;
  return (
    <>
      <span className="nx-link-pick__option-title" title={option.target.title}>
        {option.target.title}
      </span>
      {detail === undefined ? null : (
        <span className="nx-link-pick__option-detail" title={detail}>
          {detail}
        </span>
      )}
    </>
  );
}

/** One row of the open list, chosen by a click unless it cannot be used. */
function OptionRow({
  option,
  id,
  active,
  pinned,
  onHover,
  onChoose,
}: {
  option: LinkOption;
  id: string;
  active: boolean;
  /** Kept at the list's foot as it scrolls: the address after the pages. */
  pinned: boolean;
  onHover: (option: LinkOption) => void;
  onChoose: (option: LinkOption) => void;
}): React.JSX.Element {
  const usable = option.kind === "address" || option.unusable === undefined;
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={usable ? undefined : true}
      className={
        pinned
          ? "nx-link-pick__option nx-link-pick__option--pinned"
          : "nx-link-pick__option"
      }
      data-kind={option.kind}
      onMouseMove={() => {
        if (usable) onHover(option);
      }}
      // The search keeps focus while a row is clicked, so typing goes on.
      onMouseDown={event => event.preventDefault()}
      onClick={() => {
        if (usable) onChoose(option);
      }}
    >
      <OptionWords option={option} />
      {/* Drawn on every row and shown on the active one only: it says
          which row Enter takes. */}
      <CornerDownLeft
        aria-hidden="true"
        size={12}
        className="nx-link-pick__enter"
      />
    </li>
  );
}

/** The open list: the search, the pages and entries by collection, and the address. */
function LinkList({
  label,
  typed,
  onType,
  find,
  entryLinks,
  onChoose,
}: {
  label: string;
  typed: string;
  onType: (typed: string) => void;
  find: FindLinkTargets | undefined;
  entryLinks: boolean;
  onChoose: (option: LinkOption) => void;
}): React.JSX.Element {
  const listId = React.useId();
  const targets = useTargets(find, typed, true);
  const options = optionsFor(typed, targets, entryLinks);
  const usable = options.filter(
    option => option.kind === "address" || option.unusable === undefined
  );
  const [activeKey, setActiveKey] = React.useState<string | undefined>();
  // The active row is kept by key, so a new answer keeps it where it still
  // is and falls back to the first row that can be chosen where it is not.
  const active = usable.find(option => option.key === activeKey) ?? usable[0];
  const optionId = (option: LinkOption): string =>
    `${listId}-${option.key.replace(/[^a-z0-9-]/gi, "_")}`;

  React.useEffect(() => {
    if (active === undefined) return;
    document.getElementById(optionId(active))?.scrollIntoView({
      block: "nearest",
    });
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const at = active === undefined ? -1 : usable.indexOf(active);
    const next = stepFrom(event.key, at, usable.length - 1);
    if (next !== undefined) {
      event.preventDefault();
      setActiveKey(usable[next]?.key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active !== undefined) onChoose(active);
    }
  };

  const groups = groupsOf(options);
  const address = options.find(option => option.kind === "address");
  const addressFirst = address !== undefined && options[0] === address;
  const status = listStatus(find, targets, typed, groups.length > 0);
  const row = (option: LinkOption, pinned = false): React.JSX.Element => (
    <OptionRow
      key={option.key}
      option={option}
      id={optionId(option)}
      active={option === active}
      pinned={pinned}
      onHover={hovered => setActiveKey(hovered.key)}
      onChoose={onChoose}
    />
  );

  return (
    <div className="nx-link-pick__body">
      <div className="nx-vars__search nx-link-pick__search">
        <Search aria-hidden="true" size={16} />
        <Input
          type="text"
          role="combobox"
          aria-label={`Search pages or paste a URL for ${label.toLowerCase()}`}
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={
            active === undefined ? undefined : optionId(active)
          }
          placeholder={
            find === undefined ? "Paste a URL" : "Search pages or paste a URL"
          }
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={event => {
            onType(event.target.value);
            setActiveKey(undefined);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={`Where ${label.toLowerCase()} goes`}
        className="nx-link-pick__list"
      >
        {addressFirst ? row(address) : null}
        {groups.map(group => (
          <OptionGroupList
            key={group.key}
            id={`${listId}-group-${group.key.replace(/[^a-z0-9-]/gi, "_")}`}
            group={group}
            row={row}
          />
        ))}
        {status === undefined ? null : (
          <li
            className="nx-vars__note nx-link-pick__status"
            role="presentation"
          >
            <span role="status">{status}</span>
          </li>
        )}
        {/* After the pages, the address stays pinned to the list's foot,
            ruled off from them, so a long list never scrolls it away. */}
        {!addressFirst && address !== undefined
          ? row(address, groups.length > 0)
          : null}
      </ul>
    </div>
  );
}

/** One collection's rows under its heading, as a named group of the listbox. */
function OptionGroupList({
  id,
  group,
  row,
}: {
  id: string;
  group: OptionGroup;
  row: (option: LinkOption) => React.JSX.Element;
}): React.JSX.Element {
  return (
    <li role="presentation">
      <span id={id} className="nx-vars__group-name nx-link-pick__heading">
        {group.name}
      </span>
      <ul role="group" aria-labelledby={id} className="nx-link-pick__group">
        {group.options.map(option => row(option))}
      </ul>
    </li>
  );
}

/**
 * The link "Link options" opens: the `rel` checkboxes, and any other stored
 * token as a chip that can be removed. Opened on its own when a token is
 * already stored, so a link marked sponsored says so without a click.
 */
function LinkOptions({
  rel,
  disabled,
  onRel,
}: {
  rel: unknown;
  disabled: boolean;
  onRel: (next: string | undefined) => void;
}): React.JSX.Element {
  const bodyId = React.useId();
  const [open, setOpen] = React.useState(() => relTokens(rel).length > 0);
  const others = relOthers(rel);
  const set = REL_FLAGS.filter(flag => relHas(rel, flag.token));
  // What is set, said beside the closed disclosure.
  const summary = [...set.map(flag => flag.label), ...others].join(", ");
  return (
    <div className="nx-link-options">
      <button
        type="button"
        className="nx-link-options__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(was => !was)}
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          className="nx-link-options__chevron"
        />
        <span>Link options</span>
        {open || summary === "" ? null : (
          <span className="nx-link-options__summary">{summary}</span>
        )}
      </button>
      {open ? (
        <div
          id={bodyId}
          role="group"
          aria-label="Link options"
          className="nx-link-options__body"
        >
          <div className="nx-link-options__flags">
            {REL_FLAGS.map(flag => (
              <RelFlag
                key={flag.token}
                label={flag.label}
                checked={relHas(rel, flag.token)}
                disabled={disabled}
                onChange={on => onRel(relWith(rel, flag.token, on))}
              />
            ))}
          </div>
          {others.length === 0 ? null : (
            <ul
              className="nx-link-options__others"
              aria-label="Other link relationships"
            >
              {others.map(token => (
                <li key={token} className="nx-link-options__token">
                  <span>{token}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Remove ${token}`}
                    onClick={() => onRel(relWith(rel, token, false))}
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One `rel` flag: a checkbox and the word that names it. */
function RelFlag({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-link-options__flag">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={next => onChange(next === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

/** A field drawn as it is, where the inspector offers no binding controls. */
const asDrawn: BindableWrapper = (_name, field) => field;

export interface LinkGroupFieldProps {
  readonly group: LinkGroup;
  /** The block's props, as the inspector reads them. */
  readonly props: readonly EditableProp[];
  /** Whether one prop may be set where the block sits. */
  readonly writable: (name: string) => boolean;
  /** The id of the lock reason a held control points to. */
  readonly reasonId: string;
  readonly services: ContentServices | undefined;
  /** Write several props as one edit. */
  readonly onCommitMany: (changes: LinkChanges) => BlockDocument | null | void;
  /** The link's binding controls, from the inspector; absent, none are drawn. */
  readonly bindable?: BindableWrapper | undefined;
  /** The document the block is in, whose bindings say whether the link is bound. */
  readonly document?: BlockDocument | undefined;
  /** The block's id. */
  readonly nodeId?: string | undefined;
}

/**
 * Whether the link is bound: its address, or its entry. A bound link goes
 * where its field says, so it is a link to qualify even with no address of
 * its own stored.
 */
function isLinkBound(
  group: LinkGroup,
  bound: Readonly<Record<string, unknown>> | undefined
): boolean {
  if (bound?.[group.link] !== undefined) return true;
  return group.entry !== undefined && bound?.[group.entry.id] !== undefined;
}

/** The block's bindings, where the group knows its document and block. */
function bindingsOfBlock(
  document: BlockDocument | undefined,
  nodeId: string | undefined
): Readonly<Record<string, unknown>> | undefined {
  return document === undefined || nodeId === undefined
    ? undefined
    : findNode(document.nodes, nodeId)?.bindings;
}

/**
 * What binding the link's address says: a button follows a complete entry
 * reference before its address, so binding the address empties the
 * reference in the same edit, or the button would keep going to the entry;
 * and where the block has an entry reference, the picker also offers the
 * entries a relation names, whose pick binds the reference.
 */
function bindOptions(
  group: LinkGroup,
  destination: readonly string[],
  writable: (name: string) => boolean,
  bound: Readonly<Record<string, unknown>> | undefined
): BindableOptions {
  const entry = group.entry;
  // A related entry's pick removes the address's binding, so where that
  // binding is held it is not offered either.
  const addressHeld =
    bound?.[group.link] !== undefined && !writable(group.link);
  return {
    clearsOnBind: destination.filter(name => name !== group.link),
    ...(entry === undefined
      ? {}
      : {
          entryLink: {
            link: group.link,
            ...entry,
            // A related entry's pick writes both halves, so where either is
            // held (an area that keeps the block's design) none is offered.
            writable:
              writable(entry.collection) && writable(entry.id) && !addressHeld,
          },
        }),
  };
}

/**
 * A block's link group, drawn where its link prop sits: the link, and under
 * a set link its new-tab switch and its Link options. The link's address
 * offers binding through the inspector's wrapper; a bound link counts as set,
 * so how it opens is still offered under its chip.
 */
export function LinkGroupField({
  group,
  props,
  writable,
  reasonId,
  services,
  onCommitMany,
  bindable,
  document,
  nodeId,
}: LinkGroupFieldProps): React.JSX.Element {
  const id = React.useId();
  const tabId = React.useId();
  // Each prop as it applies: what is stored, else the block's default, so a
  // block that declares a default link reads as linked, and its target and
  // rel show what applies, as every other control shows a default.
  const values = Object.fromEntries(
    props.map(prop => [prop.name, prop.value ?? prop.defaultValue])
  );
  const linkProp = props.find(prop => prop.name === group.link);
  const label =
    linkProp === undefined ? "Link" : propLabel(linkProp.name, linkProp.schema);
  const value = linkValueOf(group, values);
  const bound = bindingsOfBlock(document, nodeId);
  const linkBound = isLinkBound(group, bound);
  const linked = value.kind !== "none" || linkBound;
  const held = (name: string | undefined): string | undefined =>
    name === undefined || writable(name) ? undefined : reasonId;
  // The destination is the link and, on a button, the entry reference that
  // replaces it: a pick writes them together, so it may change only when all
  // of them may. Otherwise the link is drawn held, pointing at the reason.
  const destination = [
    group.link,
    ...(group.entry === undefined
      ? []
      : [group.entry.collection, group.entry.id]),
  ];
  const destinationWritable = destination.every(writable);
  // Something stored to clear: a link that is only the block's default has
  // none, and is changed by picking another rather than removed.
  const clearable = props.some(
    prop => destination.includes(prop.name) && prop.value != null
  );
  return (
    <div className="nx-link-group" data-link-group={group.link}>
      {/* The address's bind button sits on its row; bound, the chip stands
          for the address and the entry pick alike. */}
      {(bindable ?? asDrawn)(
        group.link,
        <HeldByLock reasonId={destinationWritable ? undefined : reasonId}>
          <div className="nx-inspector__field" data-content-control="link">
            <Label htmlFor={id}>{label}</Label>
            <LinkControl
              id={id}
              label={label}
              value={value}
              entryLinks={group.entry !== undefined}
              disabled={!destinationWritable}
              find={services?.findLinkTargets}
              clearable={clearable}
              onPick={pick => {
                const changes = pickChanges(group, pick);
                if (changes !== undefined && destinationWritable) {
                  onCommitMany(changes);
                }
              }}
              // Clears the target and the rel with the link: see `clearChanges`.
              // Where an area holds the target or the rel, the link still
              // clears and they stay as the area keeps them; the destination
              // itself is never cleared in part.
              onClear={() => {
                if (!destinationWritable) return;
                onCommitMany(
                  Object.fromEntries(
                    Object.entries(clearChanges(group)).filter(
                      ([name]) => destination.includes(name) || writable(name)
                    )
                  )
                );
              }}
            />
          </div>
        </HeldByLock>,
        bindOptions(group, destination, writable, bound)
      )}
      {!linked || group.target === undefined ? null : (
        <HeldByLock reasonId={held(group.target)}>
          <div className="nx-inspector__field" data-content-control="checkbox">
            <Label htmlFor={tabId}>Open in new tab</Label>
            <Switch
              id={tabId}
              disabled={!writable(group.target)}
              checked={values[group.target] === "_blank"}
              // Off clears the target rather than storing `_self`: the same
              // tab is what a link does with none. Unless the block's own
              // default is a new tab, which a cleared target falls back to:
              // then off is stored as `_self`, or it would not stay off.
              onCheckedChange={on => {
                const target = group.target;
                if (target === undefined) return;
                const fallsBackToNewTab =
                  props.find(prop => prop.name === target)?.defaultValue ===
                  "_blank";
                const off = fallsBackToNewTab ? "_self" : undefined;
                onCommitMany({ [target]: on ? "_blank" : off });
              }}
            />
          </div>
        </HeldByLock>
      )}
      {!linked || group.rel === undefined ? null : (
        <HeldByLock reasonId={held(group.rel)}>
          <LinkOptions
            rel={values[group.rel]}
            disabled={!writable(group.rel)}
            onRel={next => {
              if (group.rel === undefined) return;
              onCommitMany({ [group.rel]: next });
            }}
          />
        </HeldByLock>
      )}
    </div>
  );
}
