/**
 * A shared style's details, in the popover beside its row in the Shared
 * styles tab: its name and class name, what it declares, where it is used,
 * its lock, and removing it while nothing uses it.
 *
 * Drawn in the Variables tab's popover editor (`nx-vars-editor`).
 *
 * @module shared-style-details
 */
import {
  namedClassName,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import {
  KeepOrRemove,
  Refusal,
  ShowMore,
  useRefusableWrite,
} from "./panel-actions";
import {
  sharedStyleDeclares,
  sharedStyleKindName,
  sharedStyleRefusalOf,
  sharedStyleRemoval,
  sharedStyleSlug,
  sharedStyleUse,
  SHARED_STYLE_NOT_WHOLE_NOTE,
  SHARED_STYLE_RENAME_PENDING,
  SHARED_STYLE_UNCOUNTED_USES,
  type BlocksOnThisPage,
  type SharedStyleRefusal,
  type SharedStyleRemoval,
  type SharedStyleReach,
  type SharedStyleRow,
  type SharedStyleUsesPage,
} from "./shared-style-library";
import type { SharedStylesAccess } from "./shared-styles-panel";
import {
  useUses,
  USES_PAGE_SIZE,
  type UsesPage,
  type UsesRead,
} from "./uses-read";

/**
 * Remove through the host, with the in-use signal where it gives one: its
 * `removeWithReason`, else `remove`, whose words say nothing of use.
 */
export async function removeSharedStylesThrough(
  access: SharedStylesAccess,
  ids: readonly string[]
): Promise<SharedStyleRefusal | undefined> {
  if (access.removeWithReason !== undefined) {
    return access.removeWithReason(ids);
  }
  return sharedStyleRefusalOf(await access.remove(ids));
}

export interface SharedStyleDetailsProps {
  row: SharedStyleRow;
  /** The name shown: the one a rename is heading for, else the stored one. */
  name: string;
  styleContext: StyleCompileContext | undefined;
  blocks: BlocksOnThisPage;
  reach: SharedStyleReach | undefined;
  /** The reach in words, as the row says it. */
  sentence: string;
  whole: boolean | undefined;
  mayLock: boolean;
  readOnly: boolean;
  access: SharedStylesAccess | undefined;
  /**
   * A rename of any style is still being stored. Lock and Remove each write
   * the whole list of styles too, so they wait for it, whichever row it is.
   */
  held: boolean;
  /** A rename refused for this style, shown under its name. */
  issue: string | null;
  onRename: (value: string) => void;
  onRemoved: () => void;
  /**
   * The server refused to remove it. The refusal says why (still used, a
   * lock, a count no longer whole), not whether it is used: the host reads
   * its usage again to decide that.
   */
  onRefused: () => void;
}

export function SharedStyleDetails(
  props: SharedStyleDetailsProps
): React.JSX.Element {
  const { row, name, access, readOnly } = props;
  const removal = sharedStyleRemoval(
    row,
    props.blocks,
    props.reach,
    props.whole
  );
  const holdId = React.useId();
  const heldBy = props.held ? holdId : undefined;
  // The server's words for a removal it refused. Kept here, above the
  // removal, so they stay whatever the usage read again says of the row,
  // and the confirmation that said nothing uses it is gone.
  const [refused, setRefused] = React.useState<SharedStyleRefusal | null>(null);
  return (
    <div className="nx-vars-editor__body nx-shared-styles__details">
      {/* Kept at the top while the rest scrolls inside the window's height. */}
      <div className="nx-shared-styles__details-head">
        <NameField
          row={row}
          name={name}
          fixed={readOnly || row.locked || row.inCode}
          issue={props.issue}
          onRename={props.onRename}
        />
      </div>
      <HoldReason
        // Said once, above the controls it holds, which both point to.
        held={props.held && holdsAControl(props, removal)}
        id={holdId}
      />
      <LockLine
        row={row}
        name={name}
        mayLock={props.mayLock}
        access={access}
        heldBy={heldBy}
      />
      <Declares row={row} styleContext={props.styleContext} />
      <WhereUsed
        id={row.id}
        sentence={sentenceBeside(props, refused)}
        access={access}
      />
      {row.inCode ? (
        <p className="nx-shared-styles__meta">Set in your site&rsquo;s code</p>
      ) : null}
      {refused !== null ? (
        <Refusal refusal={refused.reason} />
      ) : readOnly || access === undefined ? null : (
        <Removal
          removal={removal}
          id={row.id}
          name={name}
          access={access}
          heldBy={heldBy}
          onRemoved={props.onRemoved}
          onRefused={refusal => {
            setRefused(refusal);
            props.onRefused();
          }}
        />
      )}
    </div>
  );
}

/**
 * The reach in words, unless the server has just refused a removal while the
 * index counts no use: then "Not used anywhere" would sit over a refusal
 * saying it is used, and the refusal is the truer statement.
 */
function sentenceBeside(
  props: SharedStyleDetailsProps,
  refused: SharedStyleRefusal | null
): string {
  // Only the route's in-use refusal contradicts the index: a lock, or a
  // count no longer whole, says nothing of use, so the sentence stays.
  const counted = sharedStyleUse(props.blocks, props.reach) === "used";
  return refused?.inUse === true && !counted ? "" : props.sentence;
}

/** Whether the popover shows a control a pending rename holds: Lock or Remove. */
function holdsAControl(
  props: SharedStyleDetailsProps,
  removal: SharedStyleRemoval
): boolean {
  const removable =
    !props.readOnly &&
    props.access !== undefined &&
    removal.kind === "removable";
  return removable || mayLockRow(props.row, props.mayLock, props.access);
}

/** Why a style can't be removed, or Remove, or nothing when said elsewhere. */
function Removal({
  removal,
  ...remove
}: {
  removal: SharedStyleRemoval;
} & React.ComponentProps<typeof RemoveOne>): React.JSX.Element | null {
  if (removal.kind === "refused") {
    return <p className="nx-shared-styles__meta">{removal.reason}</p>;
  }
  return removal.kind === "removable" ? <RemoveOne {...remove} /> : null;
}

/** The class name a typed name gives, or the style's own while it is unchanged. */
function typedClassName(
  row: SharedStyleRow,
  name: string,
  draft: string
): string {
  if (draft.trim() === name) return row.slug;
  return sharedStyleSlug(draft);
}

/** The Name field: committed on Enter or blur, with the class name it gives. */
function NameField({
  row,
  name,
  fixed,
  issue,
  onRename,
}: {
  row: SharedStyleRow;
  name: string;
  /** Shown, never changed: a read-only role, a lock, or the site's code. */
  fixed: boolean;
  issue: string | null;
  onRename: (value: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  const [draft, setDraft] = React.useState(name);
  const typed = typedClassName(row, name, draft);
  const commit = (value: string): void => {
    if (!fixed) onRename(value);
  };
  return (
    <>
      <div className="nx-vars-editor__field">
        <label className="nx-vars-editor__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <Input
          id={`${id}-name`}
          value={draft}
          readOnly={fixed}
          aria-invalid={issue === null ? undefined : true}
          aria-describedby={issue === null ? `${id}-code` : `${id}-issue`}
          onChange={event => setDraft(event.currentTarget.value)}
          onBlur={event => commit(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Enter") commit(event.currentTarget.value);
          }}
        />
        <p className="nx-vars-editor__code" id={`${id}-code`}>
          {typed === "" ? row.className : `.${namedClassName(typed)}`}
        </p>
        {typed === "" || typed === row.slug ? null : (
          // A class name is what hand-written CSS selects, so a change to it
          // is said before it is made.
          <p className="nx-shared-styles__hint">
            {`Pages update at once. CSS written by hand for ${row.className} must be updated too.`}
          </p>
        )}
      </div>
      <Refusal refusal={issue} id={`${id}-issue`} />
    </>
  );
}

/** What a lock says to an author who may lift it, and to one who may not. */
function lockMessage(name: string, may: boolean): string {
  return may
    ? `${name} is locked, so it can’t be changed, renamed or removed. Unlock it to change it.`
    : "Locked by your site’s designers. Ask someone who can unlock shared styles.";
}

/**
 * Why a write waits while a rename is stored, said beside the control it
 * holds, or nothing.
 */
export function HoldReason({
  held,
  id,
}: {
  held: boolean;
  id: string;
}): React.JSX.Element | null {
  if (!held) return null;
  return (
    <p className="nx-shared-styles__meta" id={id}>
      {SHARED_STYLE_RENAME_PENDING}
    </p>
  );
}

/** Whether this author may move this style's lock here. */
function mayLockRow(
  row: SharedStyleRow,
  mayLock: boolean,
  access: SharedStylesAccess | undefined
): access is SharedStylesAccess {
  return mayLock && access !== undefined && !row.inCode;
}

/** What a lock says, and Lock or Unlock for an author the server says may. */
function LockLine({
  row,
  name,
  mayLock,
  access,
  heldBy,
}: {
  row: SharedStyleRow;
  name: string;
  mayLock: boolean;
  access: SharedStylesAccess | undefined;
  /** While a rename is stored: the id of the words saying Lock waits. */
  heldBy: string | undefined;
}): React.JSX.Element | null {
  const may = mayLockRow(row, mayLock, access);
  if (!row.locked && !may) return null;
  return (
    <div className="nx-vars-editor__field">
      {row.locked ? (
        <p className="nx-shared-styles__meta">{lockMessage(name, may)}</p>
      ) : null}
      {may ? (
        <LockButton row={row} name={name} access={access} heldBy={heldBy} />
      ) : null}
    </div>
  );
}

/**
 * Lock or Unlock, with the route's refusal. Held while a rename is stored: a
 * lock and a rename each write the whole list of styles, so a lock landing
 * second would put the old name back.
 */
function LockButton({
  row,
  name,
  access,
  heldBy,
}: {
  row: SharedStyleRow;
  name: string;
  access: SharedStylesAccess;
  heldBy: string | undefined;
}): React.JSX.Element {
  const { busy, refusal, run } = useRefusableWrite();
  return (
    <>
      <Refusal refusal={refusal} />
      <div className="nx-vars-editor__actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button"
          disabled={busy || heldBy !== undefined}
          aria-describedby={heldBy}
          onClick={() => void run(() => access.lock(row.id, !row.locked))}
        >
          {row.locked ? `Unlock ${name}` : `Lock ${name}`}
        </Button>
      </div>
    </>
  );
}

/** What a style declares at the base size, and how much more elsewhere. */
function Declares({
  row,
  styleContext,
}: {
  row: SharedStyleRow;
  styleContext: StyleCompileContext | undefined;
}): React.JSX.Element {
  const declares = sharedStyleDeclares(row.styles, styleContext);
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label">Declares</span>
      {declares.lines.length === 0 ? (
        <p className="nx-shared-styles__meta">Nothing at the base size yet.</p>
      ) : (
        <ul className="nx-shared-styles__declares">
          {declares.lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {declares.elsewhere > 0 ? (
        <p className="nx-shared-styles__meta">
          {`and ${declares.elsewhere} more on other devices and states`}
        </p>
      ) : null}
    </div>
  );
}

/** Where a style is used: the reach in words, then the documents by name. */
function WhereUsed({
  id,
  sentence,
  access,
}: {
  id: string;
  sentence: string;
  access: SharedStylesAccess | undefined;
}): React.JSX.Element {
  const { read, more } = useUses(access?.uses, id);
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label">Where it&rsquo;s used</span>
      {sentence === "" ? null : (
        <p className="nx-shared-styles__reach">{sentence}</p>
      )}
      {access === undefined ? null : <UsesList read={read} onMore={more} />}
    </div>
  );
}

/** The documents read so far, "Show N more", and the ones counted unnamed. */
function UsesList({
  read,
  onMore,
}: {
  read: UsesRead<SharedStyleUsesPage>;
  onMore: () => void;
}): React.JSX.Element {
  const { last, items } = read;
  if (last === undefined || read.failed) return <UsesUnread read={read} />;
  return (
    <>
      {items.length === 0 ? null : (
        <ul className="nx-shared-styles__uses">
          {items.map(use => (
            // An id is unique only within its collection, so both key a row.
            <li key={JSON.stringify([use.collection, use.id])}>
              <span className="nx-shared-styles__use-title">{use.title}</span>
              <span className="nx-shared-styles__meta">
                {sharedStyleKindName(use.kind)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <UsesTail last={last} listed={items.length} onMore={onMore} />
    </>
  );
}

/**
 * A where-used list not read yet: that it is being read, or that the read
 * failed. Shared by every tab that lists where something is used.
 */
export function UsesUnread({
  read,
}: {
  read: { readonly failed: boolean };
}): React.JSX.Element {
  if (read.failed) {
    return <Refusal refusal="Where it’s used could not be read." />;
  }
  return (
    <p className="nx-shared-styles__meta" role="status">
      Reading where it&rsquo;s used&hellip;
    </p>
  );
}

/**
 * Under a where-used list: "Show N more" while pages follow, that the list
 * may be short while pages are being counted, and the places counted but
 * not named because this author may not open them.
 */
export function UsesTail({
  last,
  listed,
  onMore,
}: {
  last: UsesPage<unknown>;
  /** How many places the list names so far. */
  listed: number;
  /** The next page. Absent: the list is a first few, and offers no more. */
  onMore?: () => void;
}): React.JSX.Element {
  return (
    <>
      {onMore === undefined ? null : (
        <ShowMore
          hidden={last.hasNext ? last.total - listed : 0}
          pageSize={USES_PAGE_SIZE}
          onMore={onMore}
        />
      )}
      {last.complete ? null : (
        <p className="nx-shared-styles__meta">{SHARED_STYLE_NOT_WHOLE_NOTE}</p>
      )}
      {last.hidden > 0 ? (
        <p className="nx-shared-styles__meta">
          {`and ${last.hidden} you can’t open`}
        </p>
      ) : null}
    </>
  );
}

/** Remove one unused style, behind a confirmation. */
function RemoveOne({
  id,
  name,
  access,
  heldBy,
  onRemoved,
  onRefused,
}: {
  id: string;
  name: string;
  access: SharedStylesAccess;
  /** The server refused: its words, and whether it said the style is used. */
  onRefused: (refusal: SharedStyleRefusal) => void;
  /**
   * While a rename is stored: the id of the words saying Remove waits, since
   * it writes the whole list of styles too.
   */
  heldBy: string | undefined;
  onRemoved: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = React.useState(false);
  const { busy, refusal, run } = useRefusableWrite();
  const held = heldBy !== undefined;
  const remove = async (): Promise<void> => {
    let said: SharedStyleRefusal | undefined;
    const stored = await run(async () => {
      said = await removeSharedStylesThrough(access, [id]);
      return said?.reason;
    });
    if (stored) onRemoved();
    else {
      onRefused(
        said ?? {
          reason: "This shared style could not be removed.",
          inUse: false,
        }
      );
    }
  };
  return (
    <>
      <Refusal refusal={refusal} />
      {confirming ? (
        <div
          className="nx-vars-editor__confirm"
          role="group"
          aria-label={`Remove ${name}`}
        >
          {/* What the count knows, and what it cannot see: it asks even at
              a count of zero, since a zero is not permission. */}
          <p>
            Remove <strong>{name}</strong>? No page uses it in the editor.
          </p>
          <p className="nx-shared-styles__meta">
            {SHARED_STYLE_UNCOUNTED_USES}
          </p>
          <KeepOrRemove
            busy={busy}
            onKeep={() => setConfirming(false)}
            onRemove={() => void remove()}
            removeLabel={`Remove ${name}`}
            removeHeld={held}
            removeDescribedBy={heldBy}
          />
        </div>
      ) : (
        <div className="nx-vars-editor__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nx-vars-editor__button nx-vars-editor__remove"
            disabled={held}
            aria-describedby={heldBy}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      )}
    </>
  );
}
