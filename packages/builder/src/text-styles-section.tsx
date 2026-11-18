"use client";

/**
 * Design → Type → "Text styles": the site's text styles, each row previewing
 * sample text in its look beside its size and line height, and "+ Add text
 * style". A row opens its parts in a popup beside the panel
 * (`text-style-editor`); its ⋯ menu renames, duplicates, locks and removes.
 *
 * Making, copying and renaming write the site's whole class list through the
 * host's one class writer, and a part's change writes one address of the
 * style's styles, so each saves and undoes as a block style does. Lock and
 * Remove go through the shared styles' routes, which refuse to remove a text
 * style a block or a Site text row uses, saying where.
 *
 * Keyboard: Enter or Space on a row opens its parts, F2 renames it, and the
 * menu key or Shift+F10 opens its ⋯ menu. Escape in a name field puts it
 * down and hands focus back to the row it came from.
 *
 * @module text-styles-section
 */
import {
  textStylesOf,
  type BreakpointSet,
  type NamedClass,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { Ellipsis, Lock } from "lucide-react";
import * as React from "react";

import type { EditClasses } from "./block-style-actions";
import { BlockStyleNameField } from "./block-style-row-menu";
import { commitFocusedField } from "./editor-field-commit";
import { EDITOR_WORDS } from "./editor-words";
import { removeSharedStylesThrough } from "./shared-style-details";
import { sharedStyleRows, type SharedStyleRow } from "./shared-style-library";
import type { SharedStylesAccess } from "./shared-styles-types";
import { useQueuedStyles, type SharedStylesHost } from "./style-target";
import { textStyleOptions, type TextStyleOption } from "./text-style-choice";
import { TextStyleEditor } from "./text-style-editor";
import { textStyleDevices } from "./text-style-parts";
import {
  duplicateTextStylePlan,
  newTextStylePlan,
  renameTextStylePlan,
  type TextStylePlanResult,
} from "./text-style-plans";
import { CloseVariableEditor } from "./variable-value-controls";

/** What the section is handed. */
export interface TextStylesSectionProps {
  /** The site's class library, or `undefined` while it is being read. */
  readonly library: readonly NamedClass[] | undefined;
  readonly tokens: SiteTokenSet | undefined;
  /** The mode the previews are drawn in. */
  readonly mode: TokenMode;
  /** The site's devices, which a size is set for. */
  readonly breakpoints?: BreakpointSet | undefined;
  /** Shown, never changed: a role that may not change the site's design. */
  readonly readOnly: boolean;
  /** The host's whole-list class write: make, copy, rename. */
  readonly onEditClasses?: EditClasses | undefined;
  /** The host's write of one style's styles, for a part's change. */
  readonly host?: SharedStylesHost | undefined;
  /** The shared styles' routes: lock and remove. */
  readonly access?: SharedStylesAccess | undefined;
  /** Change the site's variables, for the fluid range a fluid size sets. */
  readonly onTokens?: ((tokens: SiteTokenSet) => void) | undefined;
}

/** The sample every row previews its look with, as Site text's rows do. */
const SAMPLE = "The quick survey";

/** What a write the host can't make is told. */
const NO_WRITE = "Text styles can't be changed here.";

/** The section, for the Type tab. */
export function TextStylesSection(
  props: TextStylesSectionProps
): React.JSX.Element | null {
  const headingId = React.useId();
  const { library } = props;
  if (library === undefined) return null;
  const options = textStyleOptions(library, props.tokens, props.mode);
  // The rows' locks and styles, read as the Shared styles tab reads them.
  const rows = new Map(
    sharedStyleRows(textStylesOf(library), new Set()).map(row => [row.id, row])
  );
  const writable = !props.readOnly && props.onEditClasses !== undefined;
  return (
    <section
      className="nx-vars__group nx-text-styles"
      aria-labelledby={headingId}
    >
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id={headingId}>
          {EDITOR_WORDS.textStyles}
        </h3>
      </div>
      <ul className="nx-vars__list">
        {options.map(option => {
          const row = rows.get(option.id);
          return row === undefined ? null : (
            <TextStyleRow
              key={option.id}
              option={option}
              row={row}
              panel={props}
              writable={writable}
            />
          );
        })}
      </ul>
      {options.length === 0 ? (
        <p className="nx-inspector__note">
          No text styles yet. A text style is a whole look for text, which any
          block can use from its Style tab.
        </p>
      ) : null}
      {writable ? <AddRow panel={props} /> : null}
    </section>
  );
}

/** Run a whole-list plan through the host's writer: the refusal, or the id made. */
async function runPlan(
  edit: EditClasses | undefined,
  plan: (existing: readonly NamedClass[]) => TextStylePlanResult
): Promise<{ refused: string } | { id: string }> {
  if (edit === undefined) return { refused: NO_WRITE };
  let made: string | undefined;
  const refused = await edit(existing => {
    const planned = plan(existing);
    if (!planned.ok) return { reason: planned.reason };
    made = planned.id;
    return { classes: planned.classes };
  });
  if (refused !== undefined) return { refused };
  return made === undefined ? { refused: NO_WRITE } : { id: made };
}

/** Focus a button once the field that took its place is gone. */
function focusLater(target: React.RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => target.current?.focus());
}

/** "+ Add text style", then the field its name is typed in. */
function AddRow({
  panel,
}: {
  panel: TextStylesSectionProps;
}): React.JSX.Element {
  const [naming, setNaming] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  if (naming) {
    return (
      <BlockStyleNameField
        label="New text style name"
        initial=""
        onCommit={async name => {
          const answer = await runPlan(panel.onEditClasses, existing =>
            newTextStylePlan(existing, name)
          );
          if ("refused" in answer) return answer.refused;
          setNaming(false);
          focusLater(button);
          return undefined;
        }}
        onCancel={() => {
          setNaming(false);
          focusLater(button);
        }}
      />
    );
  }
  return (
    <button
      ref={button}
      type="button"
      className="nx-block-styles__add"
      onClick={() => setNaming(true)}
    >
      + Add text style
    </button>
  );
}

/** Whether a key on a row opens its ⋯ menu: the menu key, or Shift+F10. */
function opensMenu(event: React.KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/** One row: its button, its ⋯ menu, its popup, and what was refused. */
function TextStyleRow({
  option,
  row,
  panel,
  writable,
}: {
  option: TextStyleOption;
  row: SharedStyleRow;
  panel: TextStylesSectionProps;
  writable: boolean;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const returnTo = React.useRef<HTMLElement | null>(null);
  const issueId = React.useId();
  const renamable = writable && !row.locked;
  if (renaming) {
    return (
      <li className="nx-vars__item">
        <BlockStyleNameField
          label={`Rename ${option.name}`}
          initial={option.name}
          onCommit={async name => {
            const answer = await runPlan(panel.onEditClasses, existing =>
              renameTextStylePlan(existing, row.id, name)
            );
            if ("refused" in answer) return answer.refused;
            setRenaming(false);
            focusLater(button);
            return undefined;
          }}
          onCancel={() => {
            setRenaming(false);
            focusLater(button);
          }}
        />
      </li>
    );
  }
  const actions = rowActions({ row, panel, setRefusal });
  const named = `${EDITOR_WORDS.textStyles}: ${option.name}${option.pair === "" ? "" : `, ${option.pair}`}${row.locked ? ", locked" : ""}`;
  return (
    <li className="nx-vars__item" data-open={open ? "" : undefined}>
      <Popover
        open={open}
        onOpenChange={next => {
          // A field still being typed in commits before the popup closes.
          if (!next) commitFocusedField(globalThis.document);
          setOpen(next);
        }}
        modal
      >
        <div className="nx-vars__line">
          <PopoverTrigger asChild>
            <button
              ref={button}
              type="button"
              className="nx-vars__row nx-site-text__row"
              data-text-style={row.id}
              aria-label={named}
              aria-describedby={refusal === null ? undefined : issueId}
              onKeyDown={event => {
                if (event.key === "F2" && renamable) {
                  event.preventDefault();
                  setRenaming(true);
                } else if (opensMenu(event) && writable) {
                  event.preventDefault();
                  returnTo.current = button.current;
                  setMenu(true);
                }
              }}
            >
              <span className="nx-vars__name" title={option.name}>
                {option.name}
              </span>
              <span
                className="nx-site-text__preview"
                aria-hidden="true"
                style={option.preview}
              >
                {SAMPLE}
              </span>
              <span className="nx-vars__chip" title={option.pair}>
                {row.locked ? <Lock aria-hidden="true" size={11} /> : null}
                {option.pair}
              </span>
            </button>
          </PopoverTrigger>
          {writable ? (
            <RowMenu
              name={option.name}
              locked={row.locked}
              open={menu}
              onOpenChange={setMenu}
              returnTo={returnTo}
              onRename={() => setRenaming(true)}
              {...actions}
            />
          ) : null}
        </div>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={8}
          className="nx-vars-editor nx-site-text__editor"
          aria-label={`${panel.readOnly ? "" : "Edit "}${option.name}`}
        >
          <CloseVariableEditor.Provider value={() => setOpen(false)}>
            <RowEditor row={row} name={option.name} panel={panel} />
          </CloseVariableEditor.Provider>
        </PopoverContent>
      </Popover>
      {refusal === null ? null : (
        <p className="nx-vars-editor__issue" id={issueId} role="alert">
          {refusal}
        </p>
      )}
    </li>
  );
}

/** A row's popup: its parts, edited through the host's queued writes. */
function RowEditor({
  row,
  name,
  panel,
}: {
  row: SharedStyleRow;
  name: string;
  panel: TextStylesSectionProps;
}): React.JSX.Element {
  const queued = useQueuedStyles(row, panel.host);
  const heldBy =
    panel.readOnly || panel.host === undefined || !panel.host.mayChange
      ? "You can't change this site's design."
      : row.locked
        ? `${name} is locked. Unlock it to change it.`
        : undefined;
  return (
    <TextStyleEditor
      name={name}
      styles={queued?.style.styles ?? row.styles}
      tokens={panel.tokens}
      devices={textStyleDevices(panel.breakpoints)}
      heldBy={heldBy}
      write={change =>
        queued === undefined ? Promise.resolve(NO_WRITE) : queued.write(change)
      }
      onTokens={panel.onTokens}
    />
  );
}

/** A row's menu actions, each saying a refusal under the row. */
function rowActions({
  row,
  panel,
  setRefusal,
}: {
  row: SharedStyleRow;
  panel: TextStylesSectionProps;
  setRefusal: (words: string | null) => void;
}): {
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
} {
  const said = (words: string | undefined): void => setRefusal(words ?? null);
  return {
    onDuplicate: () =>
      void runPlan(panel.onEditClasses, existing =>
        duplicateTextStylePlan(existing, row.id)
      ).then(answer => said("refused" in answer ? answer.refused : undefined)),
    onLock: () => {
      const lock = panel.access?.lock;
      if (lock === undefined) {
        said(NO_WRITE);
        return;
      }
      void lock(row.id, !row.locked).then(said);
    },
    onRemove: () => {
      const access = panel.access;
      if (access === undefined) {
        said(NO_WRITE);
        return;
      }
      // The route refuses a text style a block or a Site text row uses, and
      // its words say where.
      void removeSharedStylesThrough(access, [row.id]).then(refused =>
        said(refused?.reason)
      );
    },
  };
}

/** The row's ⋯ button and its menu. */
function RowMenu({
  name,
  locked,
  open,
  onOpenChange,
  returnTo,
  onRename,
  onDuplicate,
  onLock,
  onRemove,
}: {
  name: string;
  locked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row, while the menu key opened the menu, to hand focus back to. */
  returnTo: React.RefObject<HTMLElement | null>;
  onRename: () => void;
  onDuplicate: () => void;
  onLock: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const handingOff = React.useRef(false);
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
          const back = returnTo.current;
          if (back === null) return;
          returnTo.current = null;
          event.preventDefault();
          back.focus();
        }}
      >
        {locked ? null : (
          <DropdownMenuItem
            onSelect={() => {
              // The name field takes focus.
              handingOff.current = true;
              onRename();
            }}
          >
            Rename
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
        <DropdownMenuItem onSelect={onLock}>
          {locked ? "Unlock" : "Lock"}
        </DropdownMenuItem>
        {locked ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove}>Remove</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
