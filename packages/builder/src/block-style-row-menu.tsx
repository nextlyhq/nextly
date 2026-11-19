/**
 * A block style row's ⋯ menu and its name field: the actions the style
 * offers, and the field a rename or a new style is named in.
 *
 * Which actions a row offers follows what the style is. The block's own
 * style can be edited and made the default again; a built-in style (one a
 * block or a plugin supplies in code) can be edited, duplicated, made the
 * default and hidden, never renamed or removed; a style the site made can be
 * edited, made the default, renamed, duplicated and removed.
 *
 * @module block-style-row-menu
 * @experimental Settles with the Styles tab's Block styles.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@nextlyhq/ui";
import { Ellipsis } from "lucide-react";
import * as React from "react";

import { BLOCK_STYLE_WORDS } from "./block-style-actions";
import { commitOnEnter } from "./inspector/commit-on-enter";

/** What a row's menu offers, from what the style is. */
export interface BlockStyleOffers {
  readonly edit: boolean;
  readonly setDefault: boolean;
  readonly rename: boolean;
  readonly duplicate: boolean;
  /** "Hide" or "Show", or nothing for a style that can't be hidden. */
  readonly hide: "hide" | "show" | undefined;
  readonly remove: boolean;
}

/** One block style as its menu reads it. */
export interface BlockStyleKind {
  /** The block's own style, the default while no style carries ★. */
  readonly own: boolean;
  /** Supplied in code by a block or a plugin. */
  readonly builtIn: boolean;
  readonly starred: boolean;
  readonly hidden: boolean;
}

/** Nothing offered: a read-only role, or a host with no writes. */
const NO_OFFERS: BlockStyleOffers = {
  edit: false,
  setDefault: false,
  rename: false,
  duplicate: false,
  hide: undefined,
  remove: false,
};

/** The actions a style offers; a read-only role is offered none. */
export function blockStyleOffers(
  style: BlockStyleKind,
  readOnly: boolean
): BlockStyleOffers {
  if (readOnly) return NO_OFFERS;
  const siteMade = !style.own && !style.builtIn;
  const builtInWorn = style.builtIn && !style.own;
  return {
    edit: true,
    setDefault: !style.starred,
    rename: siteMade,
    duplicate: !style.own,
    hide: builtInWorn ? (style.hidden ? "show" : "hide") : undefined,
    remove: siteMade,
  };
}

/** Whether a style's menu has anything to offer. */
export function offersAny(offers: BlockStyleOffers): boolean {
  return Object.values(offers).some(
    offer => offer !== false && offer !== undefined
  );
}

/** What the menu does when an item is chosen. */
export interface BlockStyleMenuActions {
  readonly onEdit: () => void;
  readonly onSetDefault: () => void;
  readonly onRename: () => void;
  readonly onDuplicate: () => void;
  readonly onHidden: (hidden: boolean) => void;
  readonly onRemove: () => void;
}

/**
 * The row's ⋯ button and its menu. The menu key and Shift+F10 on the row
 * open it too, through `open`, and closing it then hands focus back to the
 * row (`returnTo`) rather than the ⋯. An item that hands focus elsewhere
 * (the name field, the style editor) says so, so closing the menu takes
 * focus nowhere.
 */
export function BlockStyleMenu({
  name,
  offers,
  actions,
  open,
  onOpenChange,
  returnTo,
}: {
  readonly name: string;
  readonly offers: BlockStyleOffers;
  readonly actions: BlockStyleMenuActions;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes as the menu closes, while set: the row it was opened
   * from. Cleared as it is used, so a later pointer open returns to the ⋯.
   */
  readonly returnTo?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element {
  return (
    <RowMenuFrame
      name={name}
      open={open}
      onOpenChange={onOpenChange}
      {...(returnTo === undefined ? {} : { returnTo })}
    >
      {handOff => (
        <>
          {offers.edit ? (
            <DropdownMenuItem onSelect={handOff(actions.onEdit)}>
              {BLOCK_STYLE_WORDS.edit}
            </DropdownMenuItem>
          ) : null}
          {offers.setDefault ? (
            <DropdownMenuItem onSelect={actions.onSetDefault}>
              {BLOCK_STYLE_WORDS.setDefault}
            </DropdownMenuItem>
          ) : null}
          {offers.rename ? (
            <DropdownMenuItem onSelect={handOff(actions.onRename)}>
              {BLOCK_STYLE_WORDS.rename}
            </DropdownMenuItem>
          ) : null}
          {offers.duplicate ? (
            <DropdownMenuItem onSelect={handOff(actions.onDuplicate)}>
              {BLOCK_STYLE_WORDS.duplicate}
            </DropdownMenuItem>
          ) : null}
          {offers.hide === undefined ? null : (
            <DropdownMenuItem
              onSelect={() => actions.onHidden(offers.hide === "hide")}
            >
              {offers.hide === "hide"
                ? BLOCK_STYLE_WORDS.hide
                : BLOCK_STYLE_WORDS.show}
            </DropdownMenuItem>
          )}
          {offers.remove ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={actions.onRemove}>
                {BLOCK_STYLE_WORDS.remove}
              </DropdownMenuItem>
            </>
          ) : null}
        </>
      )}
    </RowMenuFrame>
  );
}

/**
 * A row's ⋯ button and its menu, whose items the caller draws: shared by
 * the Block styles and the Text styles rows. The menu key and Shift+F10 on
 * a row open it too, through `open`, and closing it then hands focus back
 * to the row (`returnTo`) rather than the ⋯. An item that hands focus
 * elsewhere runs through `handOff`, so closing the menu takes focus nowhere.
 */
export function RowMenuFrame({
  name,
  open,
  onOpenChange,
  returnTo,
  children,
}: {
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly returnTo?: React.RefObject<HTMLElement | null>;
  readonly children: (
    handOff: (then: () => void) => () => void
  ) => React.ReactNode;
}): React.JSX.Element {
  const handingOff = React.useRef(false);
  const handOff = (then: () => void) => () => {
    handingOff.current = true;
    then();
  };
  return (
    // Not modal: a modal menu marks the panel around it aria-hidden while
    // its rows stay focusable.
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-vars__icon-button nx-vars__more"
          aria-label={`More actions for ${name}`}
        >
          <Ellipsis aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="nx-vars__menu"
        onCloseAutoFocus={event => {
          if (handingOff.current) {
            handingOff.current = false;
            event.preventDefault();
            return;
          }
          if (returnTo === undefined) return;
          const back = returnTo.current;
          if (back === null) return;
          returnTo.current = null;
          event.preventDefault();
          back.focus();
        }}
      >
        {children(handOff)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A block style's name being typed: a new style's, or a rename's. Enter
 * keeps it; Escape puts it down. The refusal, when the write was refused, is
 * said under it and the field stays open.
 */
export function BlockStyleNameField({
  label,
  initial,
  onCommit,
  onCancel,
}: {
  /** The field's accessible name: "New button style name", "Rename Ghost". */
  readonly label: string;
  readonly initial: string;
  /** Store the name: the refusal in words, or nothing once stored. */
  readonly onCommit: (name: string) => Promise<string | undefined>;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const issueId = React.useId();
  const commit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      setRefusal((await onCommit(value)) ?? null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nx-block-styles__name-field">
      <Input
        autoFocus
        className="nx-vars__rename-field"
        aria-label={label}
        aria-describedby={refusal === null ? undefined : issueId}
        aria-invalid={refusal === null ? undefined : true}
        value={value}
        readOnly={busy}
        onFocus={event => event.currentTarget.select()}
        onChange={event => {
          setValue(event.target.value);
          setRefusal(null);
        }}
        onKeyDown={event => {
          if (commitOnEnter(event, () => void commit())) return;
          if (event.key !== "Escape") return;
          // The innermost thing Escape closes: the field, never the canvas
          // selection or the panel around it.
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      />
      {refusal === null ? null : (
        <p className="nx-vars-editor__issue" id={issueId} role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
