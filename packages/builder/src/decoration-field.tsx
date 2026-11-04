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
 * variable that could stand for any of them) is left to the text field, so
 * nothing the CSS can say becomes unreachable.
 *
 * @module decoration-field
 */

import type { StyleValue } from "@nextlyhq/blocks-engine";
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
import * as React from "react";

// Enter commits without submitting the entry form the builder sits in.
import { commitOnEnter } from "./commit-on-enter";
import { IconChoiceField } from "./icon-choice-field";
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

/** A thickness as CSS writes one: a keyword, or a length or percentage. */
const THICKNESS =
  /^(?:auto|from-font|\+?(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|ex|ch|pt|%)?)$/i;

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
  if (THICKNESS.test(word)) return "thickness";
  // A variable may stand for any part, or several.
  if (/^(?:var|env)\(/i.test(word)) return "unreadable";
  return "color";
}

/**
 * A stored decoration as its parts, in any order the shorthand allows, or
 * `undefined` for one the icons cannot draw: no line, two lines, two of one
 * part, or a variable.
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
  const parts =
    typeof stored === "string" ? parseDecoration(stored) : undefined;
  // A part changed keeps the others: a line changed keeps its style.
  const write = (next: Partial<DecorationParts>) =>
    onCommit(
      composeDecoration({ line: parts?.line ?? "underline", ...parts, ...next })
    );
  const styled = parts !== undefined && parts.line !== "none";
  return (
    <div className="nx-style-inspector__decoration">
      <IconChoiceField
        id={id}
        labelledBy={labelledBy}
        group={LINE_GROUP}
        stored={parts?.line}
        actionName={actionName}
        describedBy={describedBy}
        onCommit={line =>
          line === null || typeof line !== "string"
            ? onCommit(null)
            : write({ line })
        }
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-style-inspector__decoration-style"
            aria-label={`${actionName} style`}
            disabled={!styled}
          >
            Style…
          </button>
        </PopoverTrigger>
        <PopoverContent className="nx-style-inspector__decoration-popover">
          {parts === undefined ? null : (
            <DecorationStyle parts={parts} write={write} />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A line style's words, each as the keyword it writes. */
const STYLE_LABELS: Readonly<Record<string, string>> = {
  "": "Default",
  solid: "Solid",
  double: "Double",
  dotted: "Dotted",
  dashed: "Dashed",
  wavy: "Wavy",
};

/**
 * The line's style, thickness and colour. A thickness is written only once
 * it is one CSS reads, and a colour only as one value; leaving either empty
 * removes it.
 */
function DecorationStyle({
  parts,
  write,
}: {
  parts: DecorationParts;
  write: (next: Partial<DecorationParts>) => CommitOutcome;
}): React.JSX.Element {
  const [thickness, setThickness] = React.useState(parts.thickness ?? "");
  const [color, setColor] = React.useState(parts.color ?? "");
  const commitThickness = () => {
    const text = thickness.trim();
    if (text === (parts.thickness ?? "")) return;
    if (text !== "" && !THICKNESS.test(text)) return;
    write({ thickness: text === "" ? undefined : text });
  };
  const commitColor = () => {
    const text = color.trim();
    if (text === (parts.color ?? "")) return;
    if (tokensOf(text).length > 1) return;
    write({ color: text === "" ? undefined : text });
  };
  return (
    <div className="nx-style-inspector__decoration-parts">
      <label className="nx-style-inspector__decoration-part">
        <span>Line style</span>
        <Select
          value={parts.style ?? ""}
          onValueChange={style =>
            write({ style: style === "" ? undefined : style })
          }
        >
          <SelectTrigger aria-label="Line style">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STYLE_LABELS)
              .filter(([value]) => value !== "")
              .map(([value, label]) => (
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
          placeholder="Text colour"
          value={color}
          onChange={event => setColor(event.target.value)}
          onBlur={commitColor}
          onKeyDown={event => commitOnEnter(event, commitColor)}
        />
      </label>
    </div>
  );
}
