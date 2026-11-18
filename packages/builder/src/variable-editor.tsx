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
  resolveTokenPrefix,
  tokenCustomProperty,
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Button, ColorPicker, Input } from "@nextlyhq/ui";
import { Undo2 } from "lucide-react";
import * as React from "react";

import { FluidButton, type FluidHook } from "./fluid-popover";
import { useRecentColours } from "./recent-colours";
import { siteTextUseWords } from "./site-text-rows";
import { colourHexOf } from "./style-colour";
import {
  clearDarkValue,
  labelNewVariable,
  fluidRangeOf,
  setFluidRange,
  setFluidSize,
  relabelToken,
  variableLabelIssue,
  writeTokenValue,
  type TokenValueWrite,
  type VariableEntry,
} from "./tokens-studio";
import {
  CodeName,
  ColourContrast,
  ModeIcon,
  UsageLine,
  VariableDescription,
} from "./variable-popup-parts";
import {
  partsOf,
  removalPlan,
  resetParts,
  withoutParts,
  type RemovalPlan,
} from "./variable-removal";
import { ShadowValue, ShadowVariables } from "./variable-shadow-value";
import { swatchStyle } from "./variable-swatch";
import type { VariableRemoval } from "./variable-usage";
import { VariableRefusal, type VariableUsageHere } from "./variable-usage-view";
import {
  LineHeightHint,
  LineHeightInput,
  SizeInput,
  useDraft,
  unwritableValue,
  valueFieldFor,
  variableCss,
  VariablePreview,
  type ValueFieldProps,
} from "./variable-value-controls";

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
  /**
   * How widely the variable is used, where the host reads it: said beside
   * Remove, which refuses in place while it is used. Absent: Remove confirms
   * as it always has.
   */
  usage?: VariableUsageHere;
  /**
   * Opened by the row's Remove: the removal starts as the editor opens, so
   * its confirm, or why it cannot go ahead, is what the author meets.
   */
  removing?: boolean;
  /**
   * Never saved: just added or copied. Its code name follows its name as it
   * is typed, until the editor closes and it is saved under one.
   */
  isNew?: boolean;
}

export function VariableEditor({
  entry,
  tokens,
  suppliedOf,
  readOnly,
  onChange,
  onRemoved,
  usage,
  removing = false,
  isNew = false,
}: VariableEditorProps): React.JSX.Element {
  const id = React.useId();
  const { row } = entry;
  const token = tokens.tokens[row.at];
  const [nameIssue, setNameIssue] = React.useState<string | undefined>();
  const [name, setName] = useDraft(entry.label);
  const { writeValue, previewValue, refusals, note } = useValueWrites(
    tokens,
    onChange
  );

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

  const said = saidUnder({ nameIssue, refusals, note, entry });

  return (
    <div
      className="nx-vars-editor__body"
      // Spell-check off for every field in the editor, the colour picker's
      // hex field included: its names and values are code-like words and
      // colour codes, which a spell-checker underlines as misspelt. Set once
      // here, since every field below inherits it.
      spellCheck={false}
    >
      <div className="nx-vars-editor__field">
        <label className="nx-vars-editor__label" htmlFor={`${id}-name`}>
          Name
        </label>
        <Input
          id={`${id}-name`}
          // No list of earlier entries over a name being typed.
          autoComplete="off"
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
        <CodeName
          id={`${id}-code`}
          property={codeNameOf(tokens, row.at, name, isNew)}
          isNew={isNew}
        />
      </div>
      <VariableDescription token={token} supplied={suppliedOf(row.identity)} />
      {token === undefined ? null : (
        <Values
          entry={entry}
          token={token}
          tokens={tokens}
          readOnly={readOnly}
          onChange={onChange}
          write={writeValue}
          preview={previewValue}
          refused={refused}
        />
      )}
      <EditorDetails
        entry={entry}
        token={token}
        tokens={tokens}
        suppliedOf={suppliedOf}
        usage={usage}
      />
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
          usage={usage}
          removing={removing}
        />
      )}
    </div>
  );
}

/**
 * What is said under the fields, in order: why the name was refused, why a
 * value was (once each: two fields refused for the same reason say it
 * once), what a write changed beyond its own field, and what the engine
 * reports about the variable and its line height.
 */
function saidUnder({
  nameIssue,
  refusals,
  note,
  entry,
}: {
  nameIssue: string | undefined;
  refusals: ReadonlyMap<string, { readonly message: string }>;
  note: string | undefined;
  entry: VariableEntry;
}): string[] {
  return [
    ...(nameIssue === undefined ? [] : [nameIssue]),
    ...new Set([...refusals.values()].map(refusal => refusal.message)),
    ...(note === undefined ? [] : [note]),
    ...entry.row.issues,
    ...(entry.lineHeight?.issues ?? []),
  ];
}

/**
 * What the editor says about the variable below its values: how widely it
 * is used, where the host reads it, and, for a colour, its contrast.
 */
function EditorDetails({
  entry,
  token,
  tokens,
  suppliedOf,
  usage,
}: {
  entry: VariableEntry;
  token: SiteToken | undefined;
  tokens: SiteTokenSet;
  suppliedOf: (identity: string) => SiteToken | undefined;
  usage: VariableUsageHere | undefined;
}): React.JSX.Element {
  return (
    <>
      {usage === undefined || token === undefined ? null : (
        // The parts Remove acts on, so a type size's line height is counted
        // and listed under its own name, as it is there.
        <UsageLine
          parts={partsOf(entry, token, tokens, suppliedOf)}
          usage={usage}
        />
      )}
      {token?.kind === "color" ? (
        <ColourContrast token={token} tokens={tokens} suppliedOf={suppliedOf} />
      ) : null}
    </>
  );
}

/**
 * The custom property a variable is written under. For one never saved, the
 * one its name as typed would give it, so it follows each keystroke; a
 * saved variable's never changes.
 */
function codeNameOf(
  tokens: SiteTokenSet,
  at: number,
  typed: string,
  isNew: boolean
): string {
  const named = isNew ? labelNewVariable(tokens, at, typed) : tokens;
  const token = named.tokens[at];
  if (token === undefined) return "";
  const { prefix } = resolveTokenPrefix(tokens.prefix);
  return tokenCustomProperty(tokenIdentity(token), prefix);
}

/**
 * The value fields' one write, and what it leaves said under the fields: the
 * fields holding a refused value, and a note about what a write changed
 * beyond its own field. Also the fields' preview, judged as the write is.
 */
function useValueWrites(
  tokens: SiteTokenSet,
  onChange: (tokens: SiteTokenSet) => void
): {
  writeValue: ValueWrite;
  previewValue: ValuePreview;
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
    const written = valueWritten(tokens, at, mode, next);
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
  const previewValue = useValuePreview(tokens);
  return { writeValue, previewValue, refusals, note };
}

/**
 * What a value would write: refused where it is typed when the site's
 * stylesheet would not write it, a value that would load a file among them,
 * rather than at the save. The one judgement a write and a preview share.
 */
function valueWritten(
  tokens: SiteTokenSet,
  at: number,
  mode: TokenMode,
  next: string
): TokenValueWrite {
  const token = tokens.tokens[at];
  const unwritable =
    token === undefined ? undefined : unwritableValue(tokens, token, next);
  if (unwritable !== undefined) return { issue: unwritable };
  return writeTokenValue(tokens, at, mode, next);
}

/**
 * The value fields' preview: each value a field is given that its write
 * would take is handed to the host to draw, and one it would refuse, such as
 * half a colour, is not, so the canvas keeps the last valid value. `null`
 * ends it, drawing what is stored again; said once, and said when the editor
 * goes away mid-edit too, so nothing unwritten stays drawn.
 */
function useValuePreview(tokens: SiteTokenSet): ValuePreview {
  const host = React.useContext(VariablePreview);
  // The host drawing an edit under way, while one is.
  const drawing = React.useRef<typeof host>(undefined);
  React.useEffect(
    () => () => {
      drawing.current?.(null);
      drawing.current = undefined;
    },
    []
  );
  return (at, mode, text) => {
    if (text === null) {
      const drew = drawing.current;
      drawing.current = undefined;
      drew?.(null);
      return;
    }
    const next = text.trim();
    if (host === undefined || next === "") return;
    // The stored value typed back is drawn as stored.
    const written =
      tokens.tokens[at]?.values[mode] === next
        ? { tokens }
        : valueWritten(tokens, at, mode, next);
    if ("issue" in written) return;
    drawing.current = host;
    host(written.tokens);
  };
}

/** Writes one variable's value for one mode, or says why it cannot. */
type ValueWrite = (at: number, mode: TokenMode, value: string) => void;

/**
 * Draws one variable's value for one mode before it is written, or, given
 * `null`, ends the drawing.
 */
type ValuePreview = (at: number, mode: TokenMode, text: string | null) => void;

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
  preview,
  refused,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  readOnly: boolean;
  onChange: (tokens: SiteTokenSet) => void;
  write: ValueWrite;
  preview: ValuePreview;
  refused: Refused;
}): React.JSX.Element {
  const { row, lineHeight } = entry;
  const pair = (at: number, held: SiteToken): React.JSX.Element => (
    // A shadow's Colour offers the site's colour variables.
    <ShadowVariables.Provider value={tokens}>
      <ModeValues
        token={held}
        cssOf={value => variableCss(tokens, held, value)}
        readOnly={readOnly}
        onCommit={(mode, value) => write(at, mode, value)}
        onPreview={(mode, text) => preview(at, mode, text)}
        onClear={() => onChange(clearDarkValue(tokens, at))}
        refusedIn={mode => refusalAt(refused, at, mode)}
        fluid={fluidHookOf({ token: held, tokens, at, onChange, readOnly })}
      />
    </ShadowVariables.Provider>
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

/** "Fluid…" for a type size's size, where it can be changed. */
function TypeSizeFluid({
  size,
  sizeAt,
  tokens,
  onChange,
  readOnly,
}: {
  size: SiteToken;
  sizeAt: number;
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
}): React.JSX.Element | null {
  const hook = fluidHookOf({
    token: size,
    tokens,
    at: sizeAt,
    onChange,
    readOnly,
  });
  return hook === undefined ? null : <FluidButton hook={hook} />;
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
          <HalfInput
            key={half.name}
            half={half.name}
            label={`${half.name}, light`}
            value={half.token.values.light}
            readOnly={readOnly}
            refusedBy={refusalAt(refused, half.at, "light")}
            onCommit={value => write(half.at, "light", value)}
            css={variableCss(tokens, half.token, half.token.values.light)}
          />
        ))}
        {hasDark ? (
          <>
            <span className="nx-vars-editor__label" aria-hidden="true">
              Dark
            </span>
            {halves.map(half => (
              <div key={half.name} className="nx-vars-editor__cell">
                <HalfInput
                  half={half.name}
                  label={`${half.name}, dark`}
                  value={half.token.values.dark ?? ""}
                  placeholder={half.token.values.light}
                  css={variableCss(
                    tokens,
                    half.token,
                    half.token.values.dark ?? half.token.values.light
                  )}
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
      <LineHeightHint
        value={line.values.light}
        mode="light"
        readOnly={readOnly}
        onCommit={value => write(lineAt, "light", value)}
      />
      {/* "Fluid…" for the size: a type size is where a fluid size is most
          wanted. */}
      <TypeSizeFluid
        size={size}
        sizeAt={sizeAt}
        tokens={tokens}
        onChange={onChange}
        readOnly={readOnly}
      />
      {line.values.dark === undefined ? null : (
        <LineHeightHint
          value={line.values.dark}
          mode="dark"
          readOnly={readOnly}
          onCommit={value => write(lineAt, "dark", value)}
        />
      )}
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
            Remove dark value
          </Button>
        )
      ) : null}
    </div>
  );
}

/**
 * One half of a type size's pair: the size with its unit menu, or the line
 * height as a multiple of the text size.
 */
function HalfInput({
  half,
  ...field
}: {
  half: string;
  label: string;
  value: string;
  placeholder?: string;
  readOnly: boolean;
  refusedBy: string | undefined;
  onCommit: (value: string) => void;
  css: string;
}): React.JSX.Element {
  return half === "Size" ? (
    <SizeInput {...field} />
  ) : (
    <LineHeightInput {...field} />
  );
}

/**
 * "Fluid…" for a size that can be changed: what it needs to read the
 * value's sizes and to store a size made fluid from two. Nothing for any
 * other kind, or where the variables are read-only.
 */
function fluidHookOf({
  token,
  tokens,
  at,
  onChange,
  readOnly,
}: {
  token: SiteToken;
  tokens: SiteTokenSet;
  at: number;
  onChange: (tokens: SiteTokenSet) => void;
  readOnly: boolean;
}): FluidHook | undefined {
  if (readOnly || token.kind !== "dimension") return undefined;
  const range = fluidRangeOf(tokens);
  return {
    sizes: token.fluid,
    value: token.values.light,
    range,
    onFluid: sizes => onChange(setFluidSize(tokens, at, sizes, range)),
    onRange: next => onChange(setFluidRange(tokens, next)),
  };
}

/**
 * One variable's Light value, then its Dark value, for every kind: a colour
 * with its swatch and picker, anything else as text.
 */
function ModeValues({
  token,
  cssOf,
  readOnly,
  onCommit,
  onPreview,
  onClear,
  refusedIn,
  fluid,
}: {
  token: SiteToken;
  /** The CSS a value of this variable writes. */
  cssOf: (value: string) => string;
  readOnly: boolean;
  onCommit: (mode: TokenMode, value: string) => void;
  /** Draws a mode's value before it is written; `null` ends it. */
  onPreview: (mode: TokenMode, text: string | null) => void;
  onClear: () => void;
  /** The reason's element while a mode's field holds a refused value. */
  refusedIn: (mode: TokenMode) => string | undefined;
  /** "Fluid…" on a size's light value, where it can be changed. */
  fluid: FluidHook | undefined;
}): React.JSX.Element {
  const Field = fieldFor(token);
  return (
    <>
      <Field
        label="Light"
        value={token.values.light}
        readOnly={readOnly}
        refusedBy={refusedIn("light")}
        onCommit={value => onCommit("light", value)}
        onPreview={text => onPreview("light", text)}
        css={cssOf(token.values.light)}
        mode="light"
      />
      {fluid === undefined ? null : <FluidButton hook={fluid} />}
      <DarkValue
        token={token}
        cssOf={cssOf}
        readOnly={readOnly}
        refusedBy={refusedIn("dark")}
        onCommit={value => onCommit("dark", value)}
        onPreview={text => onPreview("dark", text)}
        onAdd={() => onCommit("dark", token.values.light)}
        onClear={onClear}
      />
    </>
  );
}

/**
 * The field a variable's values are edited with: a colour's swatch and
 * picker, a shadow's layers, and every other kind's own field.
 */
function fieldFor(
  token: SiteToken
): (props: ValueFieldProps) => React.JSX.Element {
  if (token.kind === "color") return ColourValue;
  return token.kind === "shadow" ? ShadowValue : valueFieldFor(token);
}

/**
 * A colour: a swatch that opens the picker inline, and its hex field.
 *
 * The picker sits inside this popover rather than in a second one, so focus
 * stays in one dialog. What it composes is held as a draft and written once,
 * when the picker is closed or this editor goes away, so dragging across it
 * is one save rather than one per pointer move. Given `onPreview`, each move
 * and each colour typed is drawn on the canvas meanwhile, and the drawing
 * ends before the one write.
 *
 * Its picker lists the author's Recent colours, as a block's does; a colour
 * written here, typed or picked, joins them.
 */
export function ColourValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
  onPreview,
  mode = "light",
}: {
  label: string;
  value: string;
  readOnly: boolean;
  /** The id of the reason, while this field holds a value that was refused. */
  refusedBy?: string | undefined;
  onCommit: (value: string) => void;
  /** Draws a colour before it is written; `null` ends it. */
  onPreview?: ((text: string | null) => void) | undefined;
  /** Which mode's value this is, drawn ☀ or ☾ beside the label. */
  mode?: TokenMode | undefined;
}): React.JSX.Element {
  const id = React.useId();
  const [picking, setPicking] = React.useState(false);
  const [text, setText] = useDraft(value);
  const draft = React.useRef<string | null>(null);
  // What the picker shows while a gesture is under way, handed back to it as
  // its colour so each step builds on the last; written only when it closes.
  const [shown, setShown] = React.useState<string | null>(null);
  const [recentColours, remember] = useRecentColours();
  const latest = React.useRef({ value, onCommit, onPreview, remember });
  React.useEffect(() => {
    latest.current = { value, onCommit, onPreview, remember };
  });
  const flush = React.useCallback((): void => {
    const pending = draft.current;
    draft.current = null;
    latest.current.onPreview?.(null);
    if (pending !== null && pending !== latest.current.value) {
      latest.current.onCommit(pending);
      latest.current.remember(pending);
    }
  }, []);
  // A picker still open when the popover closes writes what it showed.
  React.useEffect(() => flush, [flush]);
  // The value it holds commits too while a refusal is shown: putting it
  // back is how a refused value is corrected, and clears the refusal.
  const commit = (typed: string): boolean => {
    onPreview?.(null);
    const next = typed.trim();
    const writes =
      !readOnly && next !== "" && (next !== value || refusedBy !== undefined);
    if (writes) onCommit(next);
    return writes;
  };
  // A typed colour joins Recent colours; text that is none is refused.
  const commitTyped = (typed: string): void => {
    if (commit(typed) && isColour(typed.trim())) remember(typed.trim());
  };
  // A recent colour is one choice, written as it is listed, as on a block,
  // and moves to the front even where it is already the value.
  const pickRecent = (colour: string): void => {
    draft.current = null;
    setShown(null);
    setText(colour);
    setPicking(false);
    commit(colour);
    remember(colour);
  };
  const { hex, paint, invalid, said } = colourFieldState(
    text.trim(),
    value,
    shown
  );
  return (
    <div className="nx-vars-editor__field">
      <label className="nx-vars-editor__label" htmlFor={id}>
        <ModeIcon mode={mode} />
        {label}
      </label>
      <div className="nx-vars-editor__colour">
        {readOnly ? (
          <span
            className="nx-vars__swatch"
            aria-hidden="true"
            data-invalid={invalid ? "" : undefined}
            style={swatchStyle(paint)}
          />
        ) : (
          <button
            type="button"
            className="nx-vars__swatch nx-vars-editor__swatch"
            data-invalid={invalid ? "" : undefined}
            aria-label={`Pick the ${label.toLowerCase()} colour${said}`}
            aria-expanded={picking}
            style={swatchStyle(paint)}
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
          // A value, not words: no list of earlier entries over the field.
          autoComplete="off"
          aria-invalid={refusedBy === undefined && !invalid ? undefined : true}
          aria-describedby={refusedBy}
          value={text}
          onChange={event => {
            setText(event.currentTarget.value);
            // Typing takes over from a picker gesture: its colour is no
            // longer shown, and closing the picker writes nothing over the
            // typed text.
            draft.current = null;
            setShown(null);
            if (!readOnly) onPreview?.(event.currentTarget.value);
          }}
          readOnly={readOnly}
          onBlur={event => commitTyped(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Enter") commitTyped(event.currentTarget.value);
          }}
        />
      </div>
      {picking ? (
        <ColorPicker
          className="nx-vars-editor__picker"
          // A value the picker cannot read starts it from white, not from
          // black, which it would claim the value is; opaque, so a colour
          // picked from there is seen.
          color={hex ?? NO_COLOUR}
          showAlpha
          recentColors={[...recentColours]}
          onRecentSelect={pickRecent}
          onColorChange={next => {
            draft.current = next;
            setShown(next);
            onPreview?.(next);
          }}
        />
      ) : null}
    </div>
  );
}

/** Where the picker starts for a value it cannot read: white. */
const NO_COLOUR = "#ffffff";

/**
 * What a colour field shows for the text in it: the colour the picker reads,
 * what the swatch paints, and whether the text is no colour at all.
 *
 * The swatch follows what is typed, so a value that is not a colour shows as
 * one at once, rather than as the last colour or as black. It is painted only
 * with a colour resolved here (`colourHexOf`), as every swatch is: `var()`,
 * `currentcolor` or `inherit` painted in the panel would take the panel's
 * colours rather than the site's. A colour the browser reads but this package
 * cannot resolve (`oklch()`, a named colour, a variable) leaves the swatch
 * empty and unmarked; only text no browser reads as a colour is marked
 * invalid, and said so in the swatch button's name. While a picker gesture is
 * under way, the picker's colour is what is shown, and the text is not judged.
 */
function colourFieldState(
  typed: string,
  value: string,
  shown: string | null
): {
  hex: string | undefined;
  paint: string | undefined;
  invalid: boolean;
  said: string;
} {
  const current = typed === "" ? value : typed;
  const invalid = shown === null && typed !== "" && !isColour(current);
  const hex = shown ?? colourHexOf(current, undefined);
  return {
    hex,
    paint: hex,
    invalid,
    said: invalid ? " (not a valid colour)" : "",
  };
}

/**
 * Whether `text` is a colour: one this package reads, or the browser does.
 * The one answer both the field's invalid mark and Recent colours read.
 */
function isColour(text: string): boolean {
  return colourHexOf(text, undefined) !== undefined || isCssColour(text);
}

/**
 * Whether the browser reads `text` as a CSS colour: any colour a stylesheet
 * takes, beyond the hex and `rgb()` the picker reads. False where the
 * browser cannot say.
 */
function isCssColour(text: string): boolean {
  const css = globalThis.CSS as { supports?: unknown } | undefined;
  return typeof css?.supports === "function"
    ? CSS.supports("color", text)
    : false;
}

/** The dark value: its field, or a line saying it follows light. */
/** The kinds a dark value is offered on; one already held is kept on any. */
const DARK_KINDS: ReadonlySet<string> = new Set(["color", "shadow"]);

function DarkValue({
  token,
  cssOf,
  readOnly,
  refusedBy,
  onCommit,
  onPreview,
  onAdd,
  onClear,
}: {
  token: SiteToken;
  cssOf: (value: string) => string;
  readOnly: boolean;
  refusedBy: string | undefined;
  onCommit: (value: string) => void;
  onPreview: (text: string | null) => void;
  onAdd: () => void;
  onClear: () => void;
}): React.JSX.Element | null {
  const dark = token.values.dark;
  if (dark === undefined) {
    // Offered on what reads differently in dark mode, colours and shadows;
    // a size or a duration has no reason to change with the mode.
    if (!DARK_KINDS.has(token.kind)) return null;
    return (
      <div className="nx-vars-editor__field">
        <span className="nx-vars-editor__label">
          <ModeIcon mode="dark" />
          Dark
        </span>
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
  const Field = fieldFor(token);
  return (
    <>
      <Field
        label="Dark"
        value={dark}
        readOnly={readOnly}
        refusedBy={refusedBy}
        onCommit={onCommit}
        onPreview={onPreview}
        css={cssOf(dark)}
        mode="dark"
      />
      {readOnly ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button nx-vars-editor__inline-action"
          onClick={onClear}
        >
          Remove dark value
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
 *
 * Where the host reads how widely the variable is used, its own half says so
 * beside Remove, and Remove, still pressable, opens why it cannot go ahead
 * while the variable is used or not counted yet, in place of the confirm.
 */
function Actions({
  entry,
  token,
  tokens,
  suppliedOf,
  onChange,
  onRemoved,
  usage,
  removing,
}: {
  entry: VariableEntry;
  token: SiteToken;
  tokens: SiteTokenSet;
  suppliedOf: (identity: string) => SiteToken | undefined;
  onChange: (tokens: SiteTokenSet) => void;
  onRemoved: () => void;
  usage: VariableUsageHere | undefined;
  removing: boolean;
}): React.JSX.Element | null {
  const plan = removalPlan(
    entry,
    partsOf(entry, token, tokens, suppliedOf),
    usage
  );
  // A Site text row pointing at what Remove takes away holds it: the row
  // would lose its size on every page, so the removal is refused here as
  // the server refuses it, naming the row.
  const heldBy = siteTextUseWords(
    tokens,
    plan.removable.map(part => part.identity)
  );
  const { step, setStep, remove } = useRemoveStep(plan, removing, heldBy);
  const shown = shownStep(step, plan.removal);
  if (shown === "held" && heldBy !== undefined) {
    return (
      <HeldRemoval
        plan={plan}
        heldBy={heldBy}
        onReset={() => onChange(resetParts(tokens, plan.changed))}
        onRemove={remove}
      />
    );
  }
  if (shown === "confirm" && plan.removable.length > 0) {
    return (
      <ConfirmRemove
        what={plan.what}
        focused={removing}
        onKeep={() => setStep("idle")}
        onRemove={() => {
          onChange(withoutParts(tokens, plan.removable));
          onRemoved();
        }}
      />
    );
  }
  if (plan.changed.length === 0 && plan.removable.length === 0) return null;
  return (
    <>
      <ActionRow
        plan={plan}
        checking={shown === "checking"}
        onReset={() => onChange(resetParts(tokens, plan.changed))}
        onRemove={remove}
      />
      {shown === "refused" &&
      plan.gate !== undefined &&
      plan.reach !== undefined ? (
        <VariableRefusal
          name={plan.named}
          loss={plan.loss}
          parts={plan.removable}
          reach={plan.reach}
          usage={plan.gate}
        />
      ) : null}
    </>
  );
}

/**
 * Remove refused because a Site text row uses what it takes away: the row
 * named, and what to do first.
 */
function HeldRemoval({
  plan,
  heldBy,
  onReset,
  onRemove,
}: {
  plan: RemovalPlan;
  heldBy: string;
  onReset: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <>
      <ActionRow
        plan={plan}
        checking={false}
        onReset={onReset}
        onRemove={onRemove}
      />
      <p className="nx-vars-editor__issue" role="status">
        {`${plan.named} is used by ${heldBy}, so it can't be removed. Point that row at another type size first.`}
      </p>
    </>
  );
}

/** How widely it is used, then Reset and Remove, as the plan offers them. */
function ActionRow({
  plan,
  checking,
  onReset,
  onRemove,
}: {
  plan: RemovalPlan;
  /** Whether Remove is reading where it is used again before it answers. */
  checking: boolean;
  onReset: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-vars-editor__actions">
      {/* How widely it is used is said above; here only that Remove is
          reading it again. */}
      <span className="nx-vars-editor__status" role="status">
        {checking ? "Checking where it's used…" : ""}
      </span>
      {plan.changed.length === 0 ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button"
          onClick={onReset}
        >
          Reset
        </Button>
      )}
      {/* Pressable while the variable is used, too: it says why it waits. */}
      {plan.removable.length === 0 ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nx-vars-editor__button nx-vars-editor__remove"
          onClick={onRemove}
        >
          {plan.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Where Remove has got to: nothing yet, reading where it is used again, its
 * confirm, or why it cannot.
 */
type RemoveStep = "idle" | "checking" | "confirm" | "refused" | "held";

/**
 * Remove's steps. Counts read earlier may say a variable is used when it no
 * longer is, so a Remove they would refuse first reads what it takes away
 * again, saying so, and answers on the fresh counts: the refusal, or the
 * confirm once nothing uses it. Nothing stale is shown while it reads; a
 * read that fails answers on the counts already kept.
 */
function useRemoveStep(
  plan: RemovalPlan,
  removing: boolean,
  /** The Site text rows holding what Remove takes away, in words, if any. */
  heldBy: string | undefined
): {
  step: RemoveStep;
  setStep: (step: RemoveStep) => void;
  remove: () => void;
} {
  const [step, setStep] = React.useState<RemoveStep>("idle");
  const { gate, removal, removable } = plan;
  const remove = (): void => {
    if (heldBy !== undefined) {
      setStep("held");
      return;
    }
    if (!refuses(removal) || gate === undefined) {
      setStep("confirm");
      return;
    }
    setStep("checking");
    const answer = (): void =>
      setStep(current => (current === "checking" ? "refused" : current));
    gate.readAgain(removable.map(part => part.identity)).then(answer, answer);
  };
  // Started once, as the editor opens for the row's Remove; the latest
  // `remove` through a ref, so the start does not repeat with each render.
  const start = React.useRef(remove);
  start.current = remove;
  React.useEffect(() => {
    if (removing) start.current();
  }, [removing]);
  return { step, setStep, remove };
}

/** Whether Remove opens why it cannot go ahead rather than the confirm. */
function refuses(removal: VariableRemoval): boolean {
  return removal === "in-use";
}

/**
 * The step shown: the confirm once a refused removal no longer refuses, as
 * when a count finds the variable unused, since the author asked to remove.
 */
function shownStep(step: RemoveStep, removal: VariableRemoval): RemoveStep {
  return step === "refused" && !refuses(removal) ? "confirm" : step;
}

/** Remove's confirm, naming what goes. */
function ConfirmRemove({
  what,
  focused,
  onKeep,
  onRemove,
}: {
  what: string;
  /** Takes focus, on Keep, as the row's Remove opened it. */
  focused: boolean;
  onKeep: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const keep = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (focused) keep.current?.focus();
  }, [focused]);
  return (
    <div
      className="nx-vars-editor__confirm"
      role="group"
      aria-label={`Remove ${what}`}
    >
      <p>
        Remove <strong>{what}</strong>? Any block using it loses that style. The
        page still renders.
      </p>
      <div className="nx-vars-editor__actions">
        <Button
          ref={keep}
          type="button"
          variant="ghost"
          size="sm"
          className="nx-vars-editor__button"
          onClick={onKeep}
        >
          Keep
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="nx-vars-editor__button"
          onClick={onRemove}
        >
          Remove {what}
        </Button>
      </div>
    </div>
  );
}
