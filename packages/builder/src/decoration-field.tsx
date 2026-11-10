"use client";

/**
 * Text decoration as icons (None, Underline, Strikethrough, Overline), with
 * the line's style, thickness and colour in a popover.
 *
 * The catalog stores `text-decoration` as free CSS, so the commonest text
 * option was a text field. This reads the shorthand into its parts and writes
 * it back from them: the line alone where nothing else is set (`underline`),
 * or the line with its style, thickness and colour (`underline wavy 2px
 * red`). A value it cannot read into those parts (two lines at once, a
 * variable that could stand for any of them, a word that is no colour) is left
 * to the text field, and the popover writes one as CSS, so nothing the CSS can
 * say becomes unreachable.
 *
 * @module decoration-field
 */

import {
  checkDimensionValue,
  cssColor,
  isCssWideKeyword,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { MoreHorizontal } from "lucide-react";
import * as React from "react";

// Enter commits without submitting the entry form the builder sits in.
import { commitOnEnter } from "./commit-on-enter";
import { IconChoiceField } from "./icon-choice-field";
import { InheritedValue } from "./inherited-value";
import { commitRawCss } from "./raw-css";
import { SectionHeld } from "./section-held";
import type { AlignmentGroup } from "./style-alignment-icons";
import { keywordLabel } from "./style-keyword-labels";

type CommitOutcome = "applied" | "refused" | "unchanged";

/** A decoration read into the parts its controls edit. */
export interface DecorationParts {
  readonly line: string;
  readonly style?: string;
  readonly thickness?: string;
  readonly color?: string;
}

const LINES = ["none", "underline", "line-through", "overline"] as const;
const STYLES = ["solid", "double", "dotted", "dashed", "wavy"] as const;

/** A variable may stand for any part of the shorthand, or several. */
const VARIABLE = /^(?:var|env)\(/i;

/**
 * Whether a word is a thickness: `auto`, `from-font`, or a length or
 * percentage as the engine's own length grammar reads one, a computed one
 * included. A CSS-wide keyword stands only alone, so it is none of a
 * shorthand's parts.
 */
function isThickness(token: string): boolean {
  return (
    !VARIABLE.test(token) &&
    !isCssWideKeyword(token) &&
    checkDimensionValue(token, {
      keywords: ["auto", "from-font"],
      allowPercentage: true,
    }) === null
  );
}

/** Whether a word is a colour the shorthand can hold. */
function isLineColor(token: string): boolean {
  return !isCssWideKeyword(token) && cssColor(token) !== undefined;
}

/** The shorthand's parts, split on whitespace outside parentheses. */
function tokensOf(text: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /[ \t\n\r\f]/.test(char)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** Which part of a decoration one of its words is, or why it cannot be read. */
function partOf(token: string): keyof DecorationParts | "unreadable" {
  const word = token.toLowerCase();
  if ((LINES as readonly string[]).includes(word)) return "line";
  if ((STYLES as readonly string[]).includes(word)) return "style";
  if (isThickness(token)) return "thickness";
  // The colour is one the page's own check reads as a colour. A variable,
  // which may stand for any part, that check refuses too.
  return isLineColor(token) ? "color" : "unreadable";
}

/**
 * A stored decoration as its parts, in any order the shorthand allows, or
 * `undefined` for one the icons cannot draw: no line, two lines, two of one
 * part, a variable, or a word that is none of the parts.
 */
export function parseDecoration(text: string): DecorationParts | undefined {
  const parts: Record<string, string> = {};
  const tokens = tokensOf(text);
  for (const token of tokens) {
    const part = partOf(token);
    if (part === "unreadable" || parts[part] !== undefined) return undefined;
    parts[part] = part === "line" ? token.toLowerCase() : token;
  }
  const { line, style, thickness, color } = parts;
  if (line === undefined) return undefined;
  return {
    line,
    ...(style === undefined ? {} : { style: style.toLowerCase() }),
    ...(thickness === undefined ? {} : { thickness }),
    ...(color === undefined ? {} : { color }),
  };
}

/** The shorthand for a decoration's parts, the line first. */
export function composeDecoration(parts: DecorationParts): string {
  return [parts.line, parts.style, parts.thickness, parts.color]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
}

/** Whether the field can draw a stored value; else the text field keeps it. */
export function drawsDecoration(stored: StyleValue | undefined): boolean {
  return (
    stored === undefined ||
    (typeof stored === "string" && parseDecoration(stored) !== undefined)
  );
}

/** The line as icons: what each shows, in its words. */
const LINE_GROUP: AlignmentGroup = {
  cssProperty: "text-decoration-line",
  options: [
    { value: "none", icon: "Minus" },
    { value: "underline", icon: "Underline" },
    { value: "line-through", icon: "Strikethrough" },
    { value: "overline", icon: "Overline" },
  ].map(option => ({
    ...option,
    label: keywordLabel("text-decoration-line", option.value),
  })),
  rest: [],
};

export function DecorationField({
  id,
  labelledBy,
  stored,
  actionName,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const own = typeof stored === "string" ? parseDecoration(stored) : undefined;
  const inherited = React.useContext(InheritedValue);
  const inheritedParts =
    stored === undefined && inherited !== undefined
      ? parseDecoration(inherited)
      : undefined;
  // What a change starts from: the value set here, or else the one inherited,
  // so a line changed here keeps the style, thickness and colour it showed.
  const parts = useQueuedParts(
    typeof stored === "string" ? stored : undefined,
    own ?? inheritedParts,
    describedBy !== undefined
  );
  // A part changed keeps the others: a line changed keeps its style.
  const write = (next: Partial<DecorationParts>) => parts.write(next, onCommit);
  // The popover is mounted outside the section's fieldset, so a section held
  // while it is open reaches its controls through this instead.
  const held = React.useContext(SectionHeld);
  return (
    <div className="nx-style-inspector__decoration">
      {/* The icons mark the inherited line, not the whole shorthand. */}
      <InheritedValue.Provider value={inheritedParts?.line ?? inherited}>
        <IconChoiceField
          id={id}
          labelledBy={labelledBy}
          group={LINE_GROUP}
          // The line just chosen while its write is on its way, so pressing
          // it again clears it; otherwise the line set here.
          stored={parts.pending ? parts.current?.line : own?.line}
          actionName={actionName}
          describedBy={describedBy}
          onCommit={line =>
            line === null || typeof line !== "string"
              ? onCommit(null)
              : write({ line })
          }
        />
      </InheritedValue.Provider>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-style-inspector__decoration-style"
            aria-label={`${actionName} style`}
            title="Style…"
          >
            {/* The strip's last segment, as More is on the other icon
                choices: its name says what it opens. */}
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {/* Mounted outside the editor's root: the builder's tokens come
            with it, and the popover's own rule gives it the inspector's
            density. */}
        <PopoverContent className="nx-builder-tokens nx-style-inspector__decoration-popover">
          <DecorationStyle
            parts={parts.current}
            write={write}
            describedBy={describedBy}
            held={held}
          >
            <DecorationCss
              stored={typeof stored === "string" ? stored : undefined}
              actionName={actionName}
              describedBy={describedBy}
              held={held}
              onCommit={value => parts.writeCss(value, onCommit)}
            />
          </DecorationStyle>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The parts a change starts from, with the changes written but not yet back
 * in the stored value. A shared style's write lands later than the commit
 * that sent it, so a second part changed meanwhile would otherwise start from
 * the old value and undo the first. The queue follows the stored value: each
 * written value arriving is dropped from it, and any other change (an undo,
 * another author) or a refused write, at once or later, empties it.
 */
function useQueuedParts(
  stored: string | undefined,
  base: DecorationParts | undefined,
  refused: boolean
): {
  current: DecorationParts | undefined;
  /** Whether a written value has yet to come back as the stored one. */
  pending: boolean;
  write: (
    next: Partial<DecorationParts>,
    onCommit: (value: StyleValue | null) => CommitOutcome
  ) => CommitOutcome;
  writeCss: (
    value: string | null,
    onCommit: (value: StyleValue | null) => CommitOutcome
  ) => CommitOutcome;
} {
  const queue = React.useRef<{ value: string; parts: DecorationParts }[]>([]);
  const [, rendered] = React.useReducer((count: number) => count + 1, 0);
  const seen = React.useRef(stored);
  if (seen.current !== stored) {
    seen.current = stored;
    const arrived = queue.current.findIndex(entry => entry.value === stored);
    queue.current = arrived === -1 ? [] : queue.current.slice(arrived + 1);
  }
  // A refusal that arrives after the write (a shared style's) leaves the
  // stored value as it was: what was queued will not arrive, so the queue
  // empties and the controls show what the document holds.
  if (refused) queue.current = [];
  const current = queue.current.at(-1)?.parts ?? base;
  /** Sends a value, queued as its parts when they can be read from it. */
  const send = (
    value: string | null,
    parts: DecorationParts | undefined,
    onCommit: (value: StyleValue | null) => CommitOutcome
  ): CommitOutcome => {
    const outcome = onCommit(value);
    // A value the parts cannot hold (cleared, two lines) leaves the queue
    // with nothing to start from, so the next part starts from what is stored.
    queue.current =
      outcome === "applied" && value !== null && parts !== undefined
        ? [...queue.current, { value, parts }]
        : [];
    // Drawn again, so the controls show the part just written.
    rendered();
    return outcome;
  };
  const write = (
    next: Partial<DecorationParts>,
    onCommit: (value: StyleValue | null) => CommitOutcome
  ): CommitOutcome => {
    const parts = { line: current?.line ?? "underline", ...current, ...next };
    return send(composeDecoration(parts), parts, onCommit);
  };
  // Written as CSS: queued too, so a part changed next keeps it.
  const writeCss = (
    value: string | null,
    onCommit: (value: StyleValue | null) => CommitOutcome
  ): CommitOutcome =>
    send(value, value === null ? undefined : parseDecoration(value), onCommit);
  return { current, pending: queue.current.length > 0, write, writeCss };
}

/**
 * A line style's words, each as the keyword it writes. Default writes none,
 * so the line takes CSS's own, solid; a select's item cannot carry an empty
 * value, so it carries this word, which no style is spelled as.
 */
const DEFAULT_STYLE = "default";
const STYLE_LABELS: Readonly<Record<string, string>> = {
  [DEFAULT_STYLE]: "Default",
  solid: "Solid",
  double: "Double",
  dotted: "Dotted",
  dashed: "Dashed",
  wavy: "Wavy",
};

/**
 * A draft that follows the value it edits: a stored change (an undo, a shared
 * style's update) moves it, so leaving the field never writes back the value
 * that change replaced.
 */
function useDraft(
  value: string | undefined
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [draft, setDraft] = React.useState(value ?? "");
  React.useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
  return [draft, setDraft];
}

/**
 * The line's style, thickness and colour, offered once there is a line to
 * style. A thickness is written only once it is one CSS reads, and a colour
 * only as one; leaving either empty removes it.
 */
function DecorationStyle({
  parts,
  write,
  describedBy,
  held,
  children,
}: {
  parts: DecorationParts | undefined;
  write: (next: Partial<DecorationParts>) => CommitOutcome;
  describedBy: string | undefined;
  /** Whether the section is held read-only. */
  held: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [thickness, setThickness] = useDraft(parts?.thickness);
  const [color, setColor] = useDraft(parts?.color);
  const disabled = held || parts === undefined || parts.line === "none";
  const refusal = {
    "aria-describedby": describedBy,
    "aria-invalid": describedBy === undefined ? undefined : true,
  } as const;
  const commitThickness = () => {
    const text = thickness.trim();
    if (text === (parts?.thickness ?? "")) return;
    if (text !== "" && !isThickness(text)) return;
    write({ thickness: text === "" ? undefined : text });
  };
  const commitColor = () => {
    const text = color.trim();
    if (text === (parts?.color ?? "")) return;
    if (text !== "" && !isLineColor(text)) return;
    write({ color: text === "" ? undefined : text });
  };
  return (
    <div className="nx-style-inspector__decoration-parts">
      <label className="nx-style-inspector__decoration-part">
        <span>Line style</span>
        <Select
          value={parts?.style ?? DEFAULT_STYLE}
          disabled={disabled}
          onValueChange={style =>
            write({ style: style === DEFAULT_STYLE ? undefined : style })
          }
        >
          <SelectTrigger aria-label="Line style" {...refusal}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STYLE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="nx-style-inspector__decoration-part">
        <span>Thickness</span>
        <Input
          aria-label="Thickness"
          {...refusal}
          disabled={disabled}
          placeholder="Auto"
          value={thickness}
          onChange={event => setThickness(event.target.value)}
          onBlur={commitThickness}
          onKeyDown={event => commitOnEnter(event, commitThickness)}
        />
      </label>
      <label className="nx-style-inspector__decoration-part">
        <span>Colour</span>
        <Input
          aria-label="Line colour"
          {...refusal}
          disabled={disabled}
          placeholder="Text colour"
          value={color}
          onChange={event => setColor(event.target.value)}
          onBlur={commitColor}
          onKeyDown={event => commitOnEnter(event, commitColor)}
        />
      </label>
      {children}
    </div>
  );
}

/**
 * The decoration as CSS, for what the icons cannot draw: two lines at once,
 * a variable. Written as typed once the author leaves the field; emptied, it
 * removes the decoration set here.
 */
function DecorationCss({
  stored,
  actionName,
  describedBy,
  held,
  onCommit,
}: {
  stored: string | undefined;
  actionName: string;
  describedBy: string | undefined;
  held: boolean;
  onCommit: (value: string | null) => CommitOutcome;
}): React.JSX.Element {
  const [text, setText] = useDraft(stored);
  const commit = () => {
    commitRawCss(text, stored, onCommit);
  };
  return (
    <label className="nx-style-inspector__decoration-part">
      <span>Write as CSS</span>
      <Input
        aria-label={`${actionName} as CSS`}
        aria-describedby={describedBy}
        aria-invalid={describedBy === undefined ? undefined : true}
        disabled={held}
        placeholder="underline overline"
        value={text}
        onChange={event => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={event => commitOnEnter(event, commit)}
      />
    </label>
  );
}
