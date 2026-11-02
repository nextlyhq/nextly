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
import {
  sameSiteToken,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
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
  return (
    <TypePair
      size={token}
      sizeAt={row.at}
      line={lineToken}
      lineAt={lineHeight.at}
      tokens={tokens}
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}

/**
 * A type size and its line height, laid out as one pair so the editor stays
 * short: the two Light values side by side, then either one "Same as light"
 * line with one action for both, or the two Dark values side by side with one
 * action to drop both.
 */
function TypePair({
  size,
  sizeAt,
  line,
  lineAt,
  tokens,
  readOnly,
  onChange,
}: {
  size: SiteToken;
  sizeAt: number;
  line: SiteToken;
  lineAt: number;
  tokens: SiteTokenSet;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const write = (at: number, mode: "light" | "dark", value: string): void =>
    onChange(setTokenValue(tokens, at, mode, value.trim()));
  const hasDark =
    size.values.dark !== undefined || line.values.dark !== undefined;
  const halves = [
    { name: "Size", at: sizeAt, token: size },
    { name: "Line height", at: lineAt, token: line },
  ];
  return (
    <div className="nx-vars-editor__field">
      <div className="nx-vars-editor__pair">
        <span aria-hidden="true" />
        {halves.map(half => (
          <span
            key={half.name}
            className="nx-vars-editor__label"
            aria-hidden="true"
          >
            {half.name}
          </span>
        ))}
        <span className="nx-vars-editor__label" aria-hidden="true">
          Light
        </span>
        {halves.map(half => (
          <CommitInput
            key={half.name}
            label={`${half.name}, light`}
            value={half.token.values.light}
            readOnly={readOnly}
            onCommit={value => write(half.at, "light", value)}
          />
        ))}
        {hasDark ? (
          <>
            <span className="nx-vars-editor__label" aria-hidden="true">
              Dark
            </span>
            {halves.map(half => (
              <CommitInput
                key={half.name}
                label={`${half.name}, dark`}
                value={half.token.values.dark ?? ""}
                placeholder={half.token.values.light}
                readOnly={readOnly}
                onCommit={value => write(half.at, "dark", value)}
              />
            ))}
          </>
        ) : null}
      </div>
      {hasDark ? (
        readOnly ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="nx-vars-editor__button nx-vars-editor__inline-action"
            onClick={() =>
              onChange(clearDarkValue(clearDarkValue(tokens, sizeAt), lineAt))
            }
          >
            Use light values
          </Button>
        )
      ) : (
        <div className="nx-vars-editor__same">
          <span>Same as light</span>
          {readOnly ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="nx-vars-editor__button"
              onClick={() =>
                onChange(
                  setTokenValue(
                    setTokenValue(tokens, sizeAt, "dark", size.values.light),
                    lineAt,
                    "dark",
                    line.values.light
                  )
                )
              }
            >
              Add dark values
            </Button>
          )}
        </div>
      )}
    </div>
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
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        {label}
      </label>
      <CommitInput
        id={id}
        value={value}
        readOnly={readOnly}
        onCommit={onCommit}
      />
    </div>
  );
}

/**
 * A value field that commits on blur or Enter, and only a real change: an
 * empty field or the value it already holds writes nothing.
 */
function CommitInput({
  id,
  label,
  value,
  placeholder,
  readOnly,
  onCommit,
}: {
  id?: string;
  /** The field's name where no visible label points at it. */
  label?: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value);
  const commit = (next: string): void => {
    if (!readOnly && next.trim() !== "" && next.trim() !== value) {
      onCommit(next);
    }
  };
  return (
    <Input
      id={id}
      aria-label={label}
      className="nx-vars-editor__mono"
      value={draft}
      placeholder={placeholder}
      onChange={event => setDraft(event.currentTarget.value)}
      readOnly={readOnly}
      onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === "Enter") commit(event.currentTarget.value);
      }}
    />
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
  // What the picker shows while a gesture is under way, handed back to it as
  // its colour so each step builds on the last; written only when it closes.
  const [shown, setShown] = React.useState<string | null>(null);
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
  const hex = shown ?? colourHexOf(value, undefined);
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
              if (picking) {
                flush();
                setShown(null);
              }
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
            setShown(next);
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="nx-vars-editor__button"
              onClick={onAdd}
            >
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
          className="nx-vars-editor__button nx-vars-editor__inline-action"
          onClick={onClear}
        >
          Use light value
        </Button>
      )}
    </>
  );
}

/**
 * Reset and Remove, each half of a type size by its own provenance.
 *
 * A half the site's code supplies can be reset when the author changed it,
 * and cannot be removed: the stored tier holds overrides, so removing it would
 * merge straight back on the next read. A half the site added can be removed,
 * behind a confirm naming it. A type size can be one of each, so both actions
 * can show at once.
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
  const parts = partsOf(entry, token, tokens, suppliedOf);
  const changed = parts.filter(
    part =>
      part.from !== undefined &&
      (part.held === undefined || !sameSiteToken(part.held, part.from))
  );
  const removable = parts.filter(part => part.from === undefined);
  // The whole variable when every half is the site's own; otherwise only the
  // half that is, named, since the other stays.
  const whole = removable.length === parts.length;
  const what = whole
    ? entry.label
    : `${removable.map(part => part.name).join(" and ")} of ${entry.label}`;
  if (confirming && removable.length > 0) {
    return (
      <div
        className="nx-vars-editor__confirm"
        role="group"
        aria-label={`Remove ${what}`}
      >
        <p>
          Remove <strong>{what}</strong>? Any block using it loses that style.
          The page still renders.
        </p>
        <div className="nx-vars-editor__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nx-vars-editor__button"
            onClick={() => setConfirming(false)}
          >
            Keep
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="nx-vars-editor__button"
            onClick={() => {
              onChange(withoutParts(tokens, removable));
              onRemoved();
            }}
          >
            Remove {what}
          </Button>
        </div>
      </div>
    );
  }
  if (changed.length === 0 && removable.length === 0) return null;
  return (
    <div className="nx-vars-editor__actions">
      {changed.length === 0 ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button"
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
      )}
      {removable.length === 0 ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-vars-editor__button nx-vars-editor__remove"
          onClick={() => setConfirming(true)}
        >
          {whole
            ? "Remove"
            : `Remove ${removable.map(part => part.name).join(" and ")}`}
        </Button>
      )}
    </div>
  );
}

/** One stored variable behind an entry, with what the site's code supplies. */
interface Part {
  name: string;
  at: number;
  held: SiteToken | undefined;
  from: SiteToken | undefined;
}

/**
 * The variables behind an entry: the row and, for a type size, its line
 * height, which has no row of its own and is acted on from here or nowhere.
 */
function partsOf(
  entry: VariableEntry,
  token: SiteToken,
  tokens: SiteTokenSet,
  suppliedOf: (identity: string) => SiteToken | undefined
): Part[] {
  const own: Part = {
    name: "size",
    at: entry.row.at,
    held: token,
    from: suppliedOf(entry.row.identity),
  };
  if (entry.lineHeight === undefined) return [own];
  return [
    own,
    {
      name: "line height",
      at: entry.lineHeight.at,
      held: tokens.tokens[entry.lineHeight.at],
      from: suppliedOf(entry.lineHeight.identity),
    },
  ];
}

/** The set without these variables, the later positions first. */
function withoutParts(
  tokens: SiteTokenSet,
  parts: readonly Part[]
): SiteTokenSet {
  return parts
    .map(part => part.at)
    .sort((a, b) => b - a)
    .reduce(removeToken, tokens);
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
