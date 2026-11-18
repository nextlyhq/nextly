"use client";

/**
 * A container's Content width, in Style › Layout: Boxed or Full width as two
 * picture buttons, and the line under them that says the width in force and
 * where it comes from, with the way to give this container its own.
 *
 * Both are the block's own settings (`contained` and `contentWidth`), not
 * styles: one value on every device, written to the block whatever the Style
 * target says. So the control is held while a shared style or a state other
 * than Normal is being edited, and says why.
 *
 * @module content-width-control
 */
import {
  checkDimensionValue,
  CONTENT_WIDTH_CLASS,
  CONTENT_WIDTH_PROP,
  CONTENT_WIDTH_PROPERTY,
  isTokenRef,
  STYLE_CATALOG,
  isStyleLeaf,
  trimCssWhitespace,
  type SiteTokenSet,
  type StyleLeaf,
  type TokenRef,
} from "@nextlyhq/blocks-engine";
import { Input } from "@nextlyhq/ui";
import * as React from "react";

import { commitOnEnter } from "./commit-on-enter";
import { CssHint } from "./css-hint";
import { arrowTo } from "./segment-choices";
import { variablesFor, type SiteVariable } from "./style-colour";
import { variableValueText } from "./style-variables";
import {
  focusAfterUnlink,
  VariableChip,
  VariableChoice,
} from "./variable-choice";

/** The site token that holds the site's content width. */
const SITE_WIDTH_TOKEN = "content.width";

/** Why the control is held while a shared style or a state is edited. */
export const CONTENT_WIDTH_HELD = "Part of this block, not of its style";

/**
 * The leaf a width is offered variables for: a maximum width's, which takes
 * every length the site names.
 */
const WIDTH_LEAF: StyleLeaf = (() => {
  const shape = STYLE_CATALOG.find(
    entry => entry.property === "maxWidth"
  )?.shape;
  return shape !== undefined && isStyleLeaf(shape)
    ? shape
    : { kind: "dimension", tokenKinds: ["dimension"] };
})() as StyleLeaf;

/** A width as stored: a length, a percentage, or a site variable. */
export type StoredWidth = string | TokenRef;

/** Whether a stored value is a width this control can show. */
export function storedWidthOf(value: unknown): StoredWidth | undefined {
  if (isTokenRef(value)) return value;
  if (typeof value === "string" && trimCssWhitespace(value) !== "") {
    return value;
  }
  return undefined;
}

/**
 * A typed width as it is stored, or `undefined` when it is no width: a length
 * or a percentage, the forms the page compile writes. A bare number is read
 * as pixels, as every length field here reads one.
 */
export function typedWidth(text: string): string | undefined {
  const value = trimCssWhitespace(text);
  if (value === "") return undefined;
  const withUnit = /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
  return checkDimensionValue(withUnit, {
    allowPercentage: true,
    functions: ["calc", "min", "max", "clamp"],
  }) === null
    ? withUnit
    : undefined;
}

/** What a width reads as in the line: its value, or its variable's. */
function widthWords(
  width: StoredWidth,
  variables: readonly SiteVariable[]
): string {
  if (!isTokenRef(width)) return trimCssWhitespace(width);
  const variable = variables.find(each => each.identity === width.$token);
  return variable === undefined ? width.$token : variableValueText(variable);
}

/** The site's content width in force, as the line says it. */
function siteWidthWords(variables: readonly SiteVariable[]): string {
  const site = variables.find(each => each.identity === SITE_WIDTH_TOKEN);
  return site === undefined
    ? "the site's content width"
    : variableValueText(site);
}

/** What {@link ContentWidthControl} is given. */
export interface ContentWidthControlProps {
  /** Whether the container is Boxed. */
  readonly contained: boolean;
  /** The width it states for itself, if it states one. */
  readonly width: StoredWidth | undefined;
  readonly tokens: SiteTokenSet | undefined;
  /** The site's width variables, in the mode the canvas shows. */
  readonly variables: readonly SiteVariable[];
  /** Why it can't be changed here, when it can't. */
  readonly held: string | undefined;
  readonly onContained: (contained: boolean) => void;
  /** A width of its own, or `undefined` to use the site's. */
  readonly onWidth: (width: StoredWidth | undefined) => void;
}

/** Content width's two choices, by the words drawn on them. */
export const CONTENT_WIDTH_CHOICES = [
  { contained: true, label: "Boxed" },
  { contained: false, label: "Full width" },
] as const;

const CHOICES = CONTENT_WIDTH_CHOICES;

/** Boxed and Full width, as a radio group of picture buttons. */
function WidthChoices({
  contained,
  labelId,
  held,
  onContained,
}: {
  contained: boolean;
  labelId: string;
  held: boolean;
  onContained: (contained: boolean) => void;
}): React.JSX.Element {
  const allowed = CHOICES.map(() => !held);
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="nx-content-width__choices"
    >
      {CHOICES.map((choice, index) => (
        // What a choice writes: Boxed puts the content-width class on the
        // root; Full width writes nothing.
        <CssHint
          key={choice.label}
          writes={
            choice.contained ? `class="${CONTENT_WIDTH_CLASS}"` : undefined
          }
        >
          <button
            type="button"
            role="radio"
            aria-checked={choice.contained === contained}
            tabIndex={choice.contained === contained ? 0 : -1}
            disabled={held}
            className="nx-content-width__choice"
            onKeyDown={event =>
              arrowTo(event, index, allowed, next => {
                const to = CHOICES[next];
                if (to !== undefined) onContained(to.contained);
              })
            }
            onClick={() => onContained(choice.contained)}
          >
            {/* The result in small: the content held in, or edge to edge. */}
            <span
              aria-hidden="true"
              className="nx-content-width__picture"
              data-shape={choice.contained ? "boxed" : "full"}
            >
              <i />
            </span>
            <span>{choice.label}</span>
          </button>
        </CssHint>
      ))}
    </div>
  );
}

/** What the width field writes: its typed width, or the site's while empty. */
function ownWidthWrites(draft: string, siteWords: string): string {
  return `${CONTENT_WIDTH_PROPERTY}: ${draft === "" ? siteWords : draft}`;
}

/** The field a width of the container's own is typed or picked in. */
function OwnWidthField({
  width,
  siteWords,
  tokens,
  variables,
  held,
  autoFocus,
  onWidth,
}: {
  width: StoredWidth | undefined;
  siteWords: string;
  tokens: SiteTokenSet | undefined;
  variables: readonly SiteVariable[];
  held: boolean;
  autoFocus: boolean;
  onWidth: (width: StoredWidth | undefined) => void;
}): React.JSX.Element {
  const id = React.useId();
  const errorId = React.useId();
  const typed = width !== undefined && !isTokenRef(width) ? width : "";
  const [draft, setDraft] = React.useState(typed);
  const [refused, setRefused] = React.useState(false);
  React.useEffect(() => setDraft(typed), [typed]);
  const commit = () => {
    if (trimCssWhitespace(draft) === trimCssWhitespace(typed)) return;
    if (trimCssWhitespace(draft) === "") {
      setRefused(false);
      onWidth(undefined);
      return;
    }
    const next = typedWidth(draft);
    setRefused(next === undefined);
    if (next !== undefined) onWidth(next);
  };
  const pick = (identity: string) => onWidth({ $token: identity });
  return (
    <div className="nx-inspector__field nx-content-width__own">
      <label className="nx-inspector__field-name" htmlFor={id}>
        Width
      </label>
      {isTokenRef(width) ? (
        <VariableChip
          leaf={WIDTH_LEAF}
          tokens={tokens}
          identity={width.$token}
          label="Width"
          onPick={pick}
          // The width the variable gives now, kept as the container's own
          // through the rule a typed width meets; "Use site default" above is
          // what removes it.
          onUnlink={value => {
            const kept =
              typeof value === "string" ? typedWidth(value) : undefined;
            if (kept === undefined) return;
            onWidth(kept);
            // The typed field takes the chip's place, holding the width.
            focusAfterUnlink(() => document.getElementById(id));
          }}
        />
      ) : (
        <span className="nx-content-width__entry">
          {/* What it writes: the container's own content width. */}
          <CssHint writes={ownWidthWrites(draft, siteWords)}>
            <Input
              id={id}
              value={draft}
              placeholder={siteWords}
              autoComplete="off"
              autoFocus={autoFocus}
              disabled={held}
              aria-invalid={refused ? true : undefined}
              aria-describedby={refused ? errorId : undefined}
              onChange={event => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={event => commitOnEnter(event, commit)}
            />
          </CssHint>
          {variables.length === 0 || held ? null : (
            <VariableChoice
              leaf={WIDTH_LEAF}
              tokens={tokens}
              current={undefined}
              label="Width"
              onPick={pick}
            />
          )}
        </span>
      )}
      {refused ? (
        <p id={errorId} className="nx-inspector__note" role="alert">
          Use a width such as 1400px or 90%.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Content width: Boxed or Full width, what is in force, and a width of the
 * container's own.
 */
export function ContentWidthControl({
  contained,
  width,
  tokens,
  variables,
  held,
  onContained,
  onWidth,
}: ContentWidthControlProps): React.JSX.Element {
  const labelId = React.useId();
  // Whether the author asked to give this container its own width, which
  // shows the field before anything is stored in it.
  const [changing, setChanging] = React.useState(false);
  const siteWords = siteWidthWords(variables);
  const own = width !== undefined;
  const isHeld = held !== undefined;
  return (
    // A fieldset, so a hold disables every control inside it at once: the
    // buttons, the field, and a held variable's chip and its list.
    <fieldset
      className="nx-content-width"
      data-control="content-width"
      disabled={isHeld}
    >
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          Content width
        </span>
        <WidthChoices
          contained={contained}
          labelId={labelId}
          held={isHeld}
          onContained={onContained}
        />
      </div>
      <p className="nx-content-width__line" aria-live="polite">
        {!contained ? (
          "Content runs edge to edge."
        ) : (
          <>
            Boxed to <b>{own ? widthWords(width, variables) : siteWords}</b>
            {own ? " · this section · " : " · site default · "}
            <button
              type="button"
              className="nx-content-width__action"
              disabled={isHeld}
              onClick={() => {
                if (own) {
                  setChanging(false);
                  onWidth(undefined);
                } else {
                  setChanging(true);
                }
              }}
            >
              {own ? "Use site default" : "Change for this section"}
            </button>
          </>
        )}
      </p>
      {contained && (own || changing) ? (
        <OwnWidthField
          width={width}
          siteWords={siteWords}
          tokens={tokens}
          variables={variables}
          held={isHeld}
          autoFocus={changing && !own}
          onWidth={onWidth}
        />
      ) : null}
      <p className="nx-inspector__note">{held ?? "Same on every device"}</p>
    </fieldset>
  );
}

/** The site's width variables, for a container's own width. */
export function widthVariables(
  tokens: SiteTokenSet | undefined,
  mode: Parameters<typeof variablesFor>[2]
): readonly SiteVariable[] {
  return variablesFor(WIDTH_LEAF, tokens, mode);
}

/** The prop a container's own width is stored under. */
export const OWN_WIDTH_PROP: string = CONTENT_WIDTH_PROP;
