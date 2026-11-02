/**
 * The editor that opens beside a variable's row: its name, its values for
 * light and dark, and removing or resetting it.
 *
 * Drawn inside the row's popover, so it is a dialog of its own: Name takes
 * focus when it opens, Tab stays inside, and Escape closes it back to the row.
 * Every field commits on blur or Enter rather than per keystroke, because a
 * variable is read by the whole site and each commit is a save.
 *
 * Read-only fields stay fields (`readOnly`, never `disabled`), so a value can
 * still be selected and copied by someone who may not change it.
 *
 * @module variable-editor
 */
import type { SiteToken, SiteTokenSet } from "@nextlyhq/blocks-engine";
import { Button, ColorPicker, Input } from "@nextlyhq/ui";
import * as React from "react";

import { colourHexOf } from "./style-colour";
import {
  clearDarkValue,
  relabelToken,
  removeToken,
  setTokenValue,
  variableLabelIssue,
  type VariableEntry,
} from "./tokens-studio";

export interface VariableEditorProps {
  entry: VariableEntry;
  tokens: SiteTokenSet;
  /**
   * The site code's own version of a variable, by identity, when it supplies
   * one. Asked for the row and for a type size's paired line height.
   */
  suppliedOf: (identity: string) => SiteToken | undefined;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
  /** The variable was removed; the popover's row no longer exists. */
  onRemoved: () => void;
}

export function VariableEditor({
  entry,
  tokens,
  suppliedOf,
  readOnly,
  onChange,
  onRemoved,
}: VariableEditorProps): React.JSX.Element {
  const id = React.useId();
  const { row, lineHeight } = entry;
  const token = tokens.tokens[row.at];
  const [nameIssue, setNameIssue] = React.useState<string | undefined>();
  const [name, setName] = useDraft(entry.label);

  const commitName = (value: string): void => {
    if (readOnly || value.trim() === entry.label) {
      setNameIssue(undefined);
      return;
    }
    const issue = variableLabelIssue(tokens, row.at, value);
    setNameIssue(issue);
    if (issue === undefined) onChange(relabelToken(tokens, row.at, value));
  };

  const said = [
    ...(nameIssue === undefined ? [] : [nameIssue]),
    ...row.issues,
    ...(lineHeight?.issues ?? []),
  ];

  return (
    <div className="nx-vars-editor__body">
      <div className="nx-vars-editor__field">
        <label className="nx-vars-editor__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={event => setName(event.currentTarget.value)}
          readOnly={readOnly}
          aria-invalid={nameIssue === undefined ? undefined : true}
          aria-describedby={said.length > 0 ? `${id}-said` : `${id}-code`}
          onBlur={event => commitName(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Enter") commitName(event.currentTarget.value);
          }}
        />
        <p className="nx-vars-editor__code" id={`${id}-code`}>
          {row.name}
        </p>
      </div>
      {token === undefined ? null : (
        <Values
          entry={entry}
          token={token}
          tokens={tokens}
          readOnly={readOnly}
          onChange={onChange}
        />
      )}
      {said.length > 0 ? (
        <p className="nx-vars-editor__issue" id={`${id}-said`} role="status">
          {said.join(" ")}
        </p>
      ) : null}
      {readOnly || token === undefined ? null : (
        <Actions
          entry={entry}
          token={token}
          tokens={tokens}
          suppliedOf={suppliedOf}
          onChange={onChange}
          onRemoved={onRemoved}
        />
      )}
    </div>
  );
}

/** The value fields a variable's kind calls for. */
function Values({
  entry,
  token,
  tokens,
  readOnly,
  onChange,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const { row, lineHeight } = entry;
  const pair = (at: number, held: SiteToken): React.JSX.Element => (
    <ModeValues
      token={held}
      readOnly={readOnly}
      onCommit={(mode, value) =>
        onChange(setTokenValue(tokens, at, mode, value.trim()))
      }
      onClear={() => onChange(clearDarkValue(tokens, at))}
    />
  );
  const lineToken =
    lineHeight === undefined ? undefined : tokens.tokens[lineHeight.at];
  if (lineHeight === undefined || lineToken === undefined) {
    return pair(row.at, token);
  }
  // A type size is two variables shown as one: each half keeps its own light
  // and dark value, grouped under its own name.
  return (
    <>
      <fieldset className="nx-vars-editor__group">
        <legend className="nx-vars-editor__legend">Size</legend>
        {pair(row.at, token)}
      </fieldset>
      <fieldset className="nx-vars-editor__group">
        <legend className="nx-vars-editor__legend">Line height</legend>
        {pair(lineHeight.at, lineToken)}
      </fieldset>
    </>
  );
}

/**
 * One variable's Light value, then its Dark value, for every kind: a colour
 * with its swatch and picker, anything else as text.
 */
function ModeValues({
  token,
  readOnly,
  onCommit,
  onClear,
}: {
  token: SiteToken;
  readOnly: boolean;
  onCommit: (mode: "light" | "dark", value: string) => void;
  onClear: () => void;
}): React.JSX.Element {
  const Field = token.kind === "color" ? ColourValue : TextValue;
  return (
    <>
      <Field
        label="Light"
        value={token.values.light}
        readOnly={readOnly}
        onCommit={value => onCommit("light", value)}
      />
      <DarkValue
        token={token}
        readOnly={readOnly}
        onCommit={value => onCommit("dark", value)}
        onAdd={() => onCommit("dark", token.values.light)}
        onClear={onClear}
      />
    </>
  );
}

/** A text field that commits when it loses focus or on Enter. */
function TextValue({
  label,
  value,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  const [draft, setDraft] = useDraft(value);
  const commit = (next: string): void => {
    if (!readOnly && next.trim() !== "" && next.trim() !== value) {
      onCommit(next);
    }
  };
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        className="nx-vars-editor__mono"
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        readOnly={readOnly}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === "Enter") commit(event.currentTarget.value);
        }}
      />
    </div>
  );
}

/**
 * A colour: a swatch that opens the picker inline, and its hex field.
 *
 * The picker sits inside this popover rather than in a second one, so focus
 * stays in one dialog. What it composes is held as a draft and written once,
 * when the picker is closed or this editor goes away, so dragging across it
 * is one save rather than one per pointer move.
 */
function ColourValue({
  label,
  value,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  const [picking, setPicking] = React.useState(false);
  const [text, setText] = useDraft(value);
  const draft = React.useRef<string | null>(null);
  const latest = React.useRef({ value, onCommit });
  React.useEffect(() => {
    latest.current = { value, onCommit };
  });
  const flush = React.useCallback((): void => {
    const pending = draft.current;
    draft.current = null;
    if (pending !== null && pending !== latest.current.value) {
      latest.current.onCommit(pending);
    }
  }, []);
  // A picker still open when the popover closes writes what it showed.
  React.useEffect(() => flush, [flush]);
  const hex = colourHexOf(value, undefined);
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <div className="nx-vars-editor__colour">
        {readOnly ? (
          <span
            className="nx-vars__swatch"
            aria-hidden="true"
            style={swatchStyle(hex)}
          />
        ) : (
          <button
            type="button"
            className="nx-vars__swatch nx-vars-editor__swatch"
            aria-label={`Pick the ${label.toLowerCase()} colour`}
            aria-expanded={picking}
            style={swatchStyle(hex)}
            onClick={() => {
              if (picking) flush();
              setPicking(open => !open);
            }}
          />
        )}
        <Input
          id={id}
          className="nx-vars-editor__mono"
          value={text}
          onChange={event => setText(event.currentTarget.value)}
          readOnly={readOnly}
          onBlur={event => {
            const next = event.currentTarget.value.trim();
            if (!readOnly && next !== "" && next !== value) onCommit(next);
          }}
          onKeyDown={event => {
            const next = event.currentTarget.value.trim();
            if (
              event.key === "Enter" &&
              !readOnly &&
              next !== "" &&
              next !== value
            ) {
              onCommit(next);
            }
          }}
        />
      </div>
      {picking ? (
        <ColorPicker
          className="nx-vars-editor__picker"
          color={hex ?? "#000000"}
          showAlpha
          onColorChange={next => {
            draft.current = next;
          }}
        />
      ) : null}
    </div>
  );
}

/** The dark value: its field, or a line saying it follows light. */
function DarkValue({
  token,
  readOnly,
  onCommit,
  onAdd,
  onClear,
}: {
  token: SiteToken;
  readOnly: boolean;
  onCommit: (value: string) => void;
  onAdd: () => void;
  onClear: () => void;
}): React.JSX.Element {
  const dark = token.values.dark;
  if (dark === undefined) {
    return (
      <div className="nx-vars-editor__field">
        <span className="nx-vars-editor__label">Dark</span>
        <div className="nx-vars-editor__same">
          <span>Same as light</span>
          {readOnly ? null : (
            // Outlined, so the action reads as one at rest, not only on hover.
            <Button type="button" variant="outline" size="sm" onClick={onAdd}>
              Add dark value
            </Button>
          )}
        </div>
      </div>
    );
  }
  const Field = token.kind === "color" ? ColourValue : TextValue;
  return (
    <>
      <Field
        label="Dark"
        value={dark}
        readOnly={readOnly}
        onCommit={onCommit}
      />
      {readOnly ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__inline-action"
          onClick={onClear}
        >
          Use light value
        </Button>
      )}
    </>
  );
}

/**
 * Reset for a variable the site's code supplies and the author changed;
 * Remove, behind a confirm naming it, for one the site added. A supplied
 * variable cannot be removed: the stored tier holds overrides, so removing one
 * would merge straight back on the next read.
 */
function Actions({
  entry,
  token,
  tokens,
  suppliedOf,
  onChange,
  onRemoved,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  suppliedOf: (identity: string) => SiteToken | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  onRemoved: () => void;
}): React.JSX.Element | null {
  const [confirming, setConfirming] = React.useState(false);
  // The row and, for a type size, its line height: the line height has no row
  // of its own, so its override is reset from here or from nowhere.
  const parts = [
    { at: entry.row.at, held: token, from: suppliedOf(entry.row.identity) },
    ...(entry.lineHeight === undefined
      ? []
      : [
          {
            at: entry.lineHeight.at,
            held: tokens.tokens[entry.lineHeight.at],
            from: suppliedOf(entry.lineHeight.identity),
          },
        ]),
  ];
  if (parts.some(part => part.from !== undefined)) {
    const changed = parts.filter(
      part =>
        part.from !== undefined &&
        (part.held === undefined || !sameAsSupplied(part.held, part.from))
    );
    if (changed.length === 0) return null;
    return (
      <div className="nx-vars-editor__actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const next = [...tokens.tokens];
            for (const part of changed) {
              if (part.from !== undefined) next[part.at] = part.from;
            }
            onChange({ ...tokens, tokens: next });
          }}
        >
          Reset
        </Button>
      </div>
    );
  }
  if (confirming) {
    return (
      <div
        className="nx-vars-editor__confirm"
        role="group"
        aria-label={`Remove ${entry.label}`}
      >
        <p>
          Remove <strong>{entry.label}</strong>? Any block using it loses that
          style. The page still renders.
        </p>
        <div className="nx-vars-editor__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onChange(withoutEntry(tokens, entry));
              onRemoved();
            }}
          >
            Remove {entry.label}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="nx-vars-editor__actions">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nx-vars-editor__remove"
        onClick={() => setConfirming(true)}
      >
        Remove
      </Button>
    </div>
  );
}

/** The set without this row, and without a type size's line height too. */
function withoutEntry(
  tokens: SiteTokenSet,
  entry: VariableEntry
): SiteTokenSet {
  // The later position first, so removing it does not move the other.
  const positions = [entry.row.at, entry.lineHeight?.at]
    .filter((at): at is number => at !== undefined)
    .sort((a, b) => b - a);
  return positions.reduce(removeToken, tokens);
}

/** Whether the variable still matches what the site's code supplies. */
function sameAsSupplied(token: SiteToken, supplied: SiteToken): boolean {
  return (
    token.name === supplied.name &&
    token.label === supplied.label &&
    token.values.light === supplied.values.light &&
    token.values.dark === supplied.values.dark
  );
}

/** A swatch painted through a custom property, or the empty swatch. */
export function swatchStyle(
  colour: string | undefined
): React.CSSProperties | undefined {
  return colour === undefined
    ? undefined
    : ({ "--nx-swatch": colour } as React.CSSProperties);
}

/**
 * What a field shows: the author's typing, until the stored value changes
 * underneath it (a reset, a refused save, an undo), which replaces it.
 *
 * A field keyed by its value would do the second by remounting, and would
 * then also remount after its own commit and drop the focus it had.
 */
function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = React.useState(value);
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  return [draft, setDraft];
}
