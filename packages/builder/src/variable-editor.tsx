/**
 * The editor that opens beside a variable's row: its name, its values for
 * light and dark, and removing or resetting it.
 *
 * Drawn inside the row's popover, so it is a dialog of its own: Name takes
 * focus when it opens, Tab stays inside, and Escape closes it back to the row.
 * Every field commits on blur or Enter rather than per keystroke, because a
 * variable is read by the whole site and each commit is handed to the host to
 * store; the host may wait for the author to pause before it does.
 *
 * Read-only fields stay fields (`readOnly`, never `disabled`), so a value can
 * still be selected and copied by someone who may not change it.
 *
 * A value the variable cannot hold is refused here, said in words under the
 * fields, and left in its field to be corrected, rather than written for the
 * save to refuse and the field to go back to what it held.
 *
 * @module variable-editor
 */
import {
  sameSiteToken,
  type SiteToken,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Button, ColorPicker, Input } from "@nextlyhq/ui";
import { Undo2 } from "lucide-react";
import * as React from "react";

import { colourHexOf } from "./style-colour";
import {
  clearDarkValue,
  relabelToken,
  removeToken,
  setTokenValue,
  variableLabelIssue,
  writeTokenValue,
  type VariableEntry,
} from "./tokens-studio";
import { swatchStyle } from "./variable-swatch";

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
  const { writeValue, refusals, note } = useValueWrites(tokens, onChange);

  const commitName = (value: string): void => {
    if (readOnly || value.trim() === entry.label) {
      setNameIssue(undefined);
      return;
    }
    const issue = variableLabelIssue(tokens, row.at, value);
    setNameIssue(issue);
    if (issue === undefined) onChange(relabelToken(tokens, row.at, value));
  };

  const saidId = `${id}-said`;
  const refused: Refused = { fields: refusals, describedBy: saidId };

  const said = [
    ...(nameIssue === undefined ? [] : [nameIssue]),
    // Once each: two fields refused for the same reason say it once.
    ...new Set([...refusals.values()].map(refusal => refusal.message)),
    ...(note === undefined ? [] : [note]),
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
          write={writeValue}
          refused={refused}
        />
      )}
      {said.length > 0 ? (
        <p className="nx-vars-editor__issue" id={saidId} role="status">
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

/**
 * The value fields' one write, and what it leaves said under the fields: the
 * fields holding a refused value, and a note about what a write changed
 * beyond its own field.
 */
function useValueWrites(
  tokens: SiteTokenSet,
  onChange: (tokens: SiteTokenSet) => void
): {
  writeValue: ValueWrite;
  refusals: ReadonlyMap<string, RefusedValue>;
  note: string | undefined;
} {
  // Each field holding a refused value, with why and with the value the field
  // stored when it was refused: that field is marked and the reason said under
  // the fields until THAT field is corrected, whatever else is committed.
  const [recorded, setRefusals] = React.useState<
    ReadonlyMap<string, RefusedValue>
  >(() => new Map());
  // A refusal lasts only while its field stores what it did when refused. A
  // control that replaces or removes the value (Use light value, Reset, an
  // undo) also replaces what the field shows, so its refusal goes with it.
  const refusals = liveRefusals(recorded, tokens);
  if (refusals.size !== recorded.size) setRefusals(refusals);
  const refuse = (at: number, mode: TokenMode, message?: string): void =>
    setRefusals(current => {
      const key = fieldKey(at, mode);
      if (current.get(key)?.message === message) return current;
      const next = new Map(current);
      if (message === undefined) next.delete(key);
      else next.set(key, { message, held: tokens.tokens[at]?.values[mode] });
      return next;
    });
  // What a write changed beyond its own field, said until the next write.
  // It lasts, as a refusal does, only while the variable holds what that
  // write left: Add dark values, Reset or an undo that changes it ends it.
  const [noted, setNote] = React.useState<WriteNote>();
  const note =
    noted !== undefined &&
    JSON.stringify(tokens.tokens[noted.at]?.values) === noted.values
      ? noted.text
      : undefined;
  if (noted !== undefined && note === undefined) setNote(undefined);

  /*
   * Every value field writes through here, so a refusal is decided once. The
   * value it already holds writes nothing and clears a message, which is how
   * putting back what was there before a refusal reads as fixing it.
   */
  const writeValue: ValueWrite = (at, mode, value) => {
    const next = value.trim();
    if (tokens.tokens[at]?.values[mode] === next) {
      refuse(at, mode);
      return;
    }
    const written = writeTokenValue(tokens, at, mode, next);
    if ("issue" in written) {
      refuse(at, mode, written.issue);
      return;
    }
    refuse(at, mode);
    setNote(
      written.note === undefined
        ? undefined
        : {
            text: written.note,
            at,
            values: JSON.stringify(written.tokens.tokens[at]?.values),
          }
    );
    onChange(written.tokens);
  };
  return { writeValue, refusals, note };
}

/** Writes one variable's value for one mode, or says why it cannot. */
type ValueWrite = (at: number, mode: TokenMode, value: string) => void;

/** A note a write left, and what its variable held once written, as JSON. */
interface WriteNote {
  text: string;
  at: number;
  values: string;
}

/** A refused value's reason, and what its field stored when it was refused. */
interface RefusedValue {
  message: string;
  held: string | undefined;
}

/**
 * The refusals still about what their fields store; the same map when every
 * one is, so a render that changes nothing sets no state.
 */
function liveRefusals(
  recorded: ReadonlyMap<string, RefusedValue>,
  tokens: SiteTokenSet
): ReadonlyMap<string, RefusedValue> {
  const live = [...recorded].filter(([key, refusal]) => {
    const [at, mode] = key.split(":");
    const values = tokens.tokens[Number(at)]?.values;
    return (mode === "dark" ? values?.dark : values?.light) === refusal.held;
  });
  return live.length === recorded.size ? recorded : new Map(live);
}

/** One value field: a stored variable's position and a mode. */
function fieldKey(at: number, mode: TokenMode): string {
  return `${String(at)}:${mode}`;
}

/** The fields holding a refused value, and the reason's element to point at. */
interface Refused {
  fields: ReadonlyMap<string, RefusedValue>;
  describedBy: string;
}

/** The marking a field takes while it holds a refused value, or none. */
function refusalAt(
  refused: Refused,
  at: number,
  mode: TokenMode
): string | undefined {
  return refused.fields.has(fieldKey(at, mode))
    ? refused.describedBy
    : undefined;
}

/** The value fields a variable's kind calls for. */
function Values({
  entry,
  token,
  tokens,
  readOnly,
  onChange,
  write,
  refused,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
  write: ValueWrite;
  refused: Refused;
}): React.JSX.Element {
  const { row, lineHeight } = entry;
  const pair = (at: number, held: SiteToken): React.JSX.Element => (
    <ModeValues
      token={held}
      readOnly={readOnly}
      onCommit={(mode, value) => write(at, mode, value)}
      onClear={() => onChange(clearDarkValue(tokens, at))}
      refusedIn={mode => refusalAt(refused, at, mode)}
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
      write={write}
      refused={refused}
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
  write,
  refused,
}: {
  size: SiteToken;
  sizeAt: number;
  line: SiteToken;
  lineAt: number;
  tokens: SiteTokenSet;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
  write: ValueWrite;
  refused: Refused;
}): React.JSX.Element {
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
            refusedBy={refusalAt(refused, half.at, "light")}
            onCommit={value => write(half.at, "light", value)}
          />
        ))}
        {hasDark ? (
          <>
            <span className="nx-vars-editor__label" aria-hidden="true">
              Dark
            </span>
            {halves.map(half => (
              <div key={half.name} className="nx-vars-editor__cell">
                <CommitInput
                  label={`${half.name}, dark`}
                  value={half.token.values.dark ?? ""}
                  placeholder={half.token.values.light}
                  readOnly={readOnly}
                  refusedBy={refusalAt(refused, half.at, "dark")}
                  onCommit={value => write(half.at, "dark", value)}
                />
                {/* Each half returns to following light on its own; the
                    action for both is below. */}
                {readOnly || half.token.values.dark === undefined ? null : (
                  <button
                    type="button"
                    className="nx-vars__icon-button nx-vars-editor__cell-action"
                    aria-label={`Use light ${half.name.toLowerCase()}`}
                    title={`Use light ${half.name.toLowerCase()}`}
                    onClick={() => onChange(clearDarkValue(tokens, half.at))}
                  >
                    <Undo2 aria-hidden="true" size={14} />
                  </button>
                )}
              </div>
            ))}
          </>
        ) : null}
      </div>
      {hasDark ? (
        readOnly ||
        halves.some(half => half.token.values.dark === undefined) ? null : (
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
  refusedIn,
}: {
  token: SiteToken;
  readOnly: boolean;
  onCommit: (mode: TokenMode, value: string) => void;
  onClear: () => void;
  /** The reason's element while a mode's field holds a refused value. */
  refusedIn: (mode: TokenMode) => string | undefined;
}): React.JSX.Element {
  const Field = token.kind === "color" ? ColourValue : TextValue;
  return (
    <>
      <Field
        label="Light"
        value={token.values.light}
        readOnly={readOnly}
        refusedBy={refusedIn("light")}
        onCommit={value => onCommit("light", value)}
      />
      <DarkValue
        token={token}
        readOnly={readOnly}
        refusedBy={refusedIn("dark")}
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
  refusedBy,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  refusedBy?: string | undefined;
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
        refusedBy={refusedBy}
        onCommit={onCommit}
      />
    </div>
  );
}

/**
 * A value field that commits on blur or Enter, and only a real change: an
 * empty field or the value it already holds writes nothing. While it holds a
 * refused value, the value it held before is committed too, since putting it
 * back is how the author answers the refusal.
 */
function CommitInput({
  id,
  label,
  value,
  placeholder,
  readOnly,
  refusedBy,
  onCommit,
}: {
  id?: string;
  /** The field's name where no visible label points at it. */
  label?: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  /** The id of the reason, while this field holds a value that was refused. */
  refusedBy?: string | undefined;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useDraft(value);
  const commit = (next: string): void => {
    if (
      !readOnly &&
      next.trim() !== "" &&
      (next.trim() !== value || refusedBy !== undefined)
    ) {
      onCommit(next);
    }
  };
  return (
    <Input
      id={id}
      aria-label={label}
      aria-invalid={refusedBy === undefined ? undefined : true}
      aria-describedby={refusedBy}
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
  refusedBy,
  onCommit,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  /** The id of the reason, while this field holds a value that was refused. */
  refusedBy?: string | undefined;
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
          aria-invalid={refusedBy === undefined ? undefined : true}
          aria-describedby={refusedBy}
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
  refusedBy,
  onCommit,
  onAdd,
  onClear,
}: {
  token: SiteToken;
  readOnly: boolean;
  refusedBy: string | undefined;
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
        refusedBy={refusedBy}
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
