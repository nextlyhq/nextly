"use client";

/**
 * The shadow control: a shadow built with fields rather than typed as CSS.
 *
 * Each layer has an X offset, a Y offset, a Blur and a Spread, each a size
 * with its unit menu, a Colour (a colour variable or a colour of its own,
 * through the colour picker) and "Inside". "+ Add layer" adds another, and a
 * layer can be moved and removed. A preview card shows the result in light,
 * and in dark where a colour it uses has a dark value.
 *
 * "Edit as CSS" shows the shadow as the CSS it is stored as. Typed CSS is
 * read back into the fields where it can be; where it cannot, it is kept
 * exactly as typed, said to be shown as CSS, and still checked.
 *
 * Given `onPreview`, as a shadow variable is, the whole shadow is offered to
 * be drawn as any of its fields is typed or its colour picked, a shadow CSS
 * would draw nothing for never among them, and every write says the edit is
 * over first.
 *
 * ONE control for every shadow: a shadow variable in Design and a block's
 * shadow in its Style tab both draw it, so the two never offer different
 * ways to build the same thing.
 *
 * @module shadow-control
 */
import {
  checkTokenKind,
  getStyleProperty,
  isTokenRef,
  tokenRef,
  type SiteTokenSet,
  type StyleValue,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Button, Switch } from "@nextlyhq/ui";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import * as React from "react";

import {
  NEW_SHADOW_LAYER,
  readShadow,
  SHADOW_COLOUR_LEAF,
  shadowFollowsDark,
  shadowPreview,
  writeShadow,
  type ShadowColour,
  type ShadowLayer,
} from "../../shadow-css";
import { variableFor } from "../../style-colour";
import { styleControlsFor, type StyleControl } from "../../style-controls";
import { SizeValue } from "../../variable-value-controls";
import { CssHint, CssNamesLine } from "../css-hint";

import { ColourField } from "./style-colour-field";
import { TypesLiveContext } from "./style-field-surroundings";

/** What a shadow control is given by the place that draws it. */
export interface ShadowControlProps {
  /** What it is called: "Light", "Dark", or the field's own name. */
  readonly label: string;
  /** The stored CSS; empty where nothing is set. */
  readonly value: string;
  readonly tokens: SiteTokenSet | undefined;
  readonly readOnly: boolean;
  /**
   * The declaration a value writes, shown on hover over each field. Absent
   * where the field around the control already says it, as a block's does.
   */
  readonly writesOf?: ((css: string) => string) | undefined;
  /** The CSS names printed inline while "Show CSS names" is on. */
  readonly names?: readonly string[] | undefined;
  /** The id of a reason the host shows, while it refuses the value. */
  readonly refusedBy?: string | undefined;
  /** Writes the new CSS: `none` once the last layer is removed. */
  readonly onCommit: (css: string) => void;
  /**
   * Draws the shadow as it is being edited, before it is written; `null` once
   * the edit ends, said before the write. Absent, a field writes when it is
   * left.
   */
  readonly onPreview?: ((css: string | null) => void) | undefined;
}

/**
 * A field's preview of the layer it is part of: the layer with that field's
 * value in it, or `null` once the field's edit ends.
 */
type LayerPreview = (layer: ShadowLayer | null) => void;

/** What the CSS view says where the CSS can't be fields. */
const KEPT_AS_CSS = "Shown as CSS because it can't be shown as fields";

/**
 * The colour picker a layer's Colour is chosen with: a block panel colour
 * control, offering every colour variable the site has, with no contrast
 * partner, since a shadow sits behind no text of its own.
 */
const SHADOW_COLOUR_CONTROL = shadowColourControl();

function shadowColourControl():
  | (StyleControl & { leaf: typeof SHADOW_COLOUR_LEAF })
  | undefined {
  const outline = getStyleProperty("outline");
  if (outline === undefined) return undefined;
  const control = styleControlsFor(outline).controls.find(
    candidate => candidate.leaf.kind === "color"
  );
  return control === undefined
    ? undefined
    : { ...control, leaf: SHADOW_COLOUR_LEAF };
}

/** Why a shadow can't be written, in a sentence, or nothing. */
function shadowRefusal(css: string): string | undefined {
  const mismatch = checkTokenKind("shadow", css);
  return mismatch === undefined ? undefined : `This shadow ${mismatch}.`;
}

export function ShadowControl(props: ShadowControlProps): React.JSX.Element {
  const { label, value, tokens, readOnly, names } = props;
  const id = React.useId();
  const reading = readShadow(value, tokens);
  const [asCss, setAsCss] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | undefined>();
  // Every write is checked first: a field can make a shadow CSS draws
  // nothing for, a negative blur among them, and typed CSS can be anything.
  const write = (css: string): boolean => {
    // The edit is over, written or not.
    props.onPreview?.(null);
    const refused = shadowRefusal(css);
    setRefusal(refused);
    if (refused !== undefined) return false;
    if (css !== value) props.onCommit(css);
    return true;
  };
  // A shadow being edited, drawn where it is one CSS would draw; the canvas
  // keeps the last that was.
  const preview =
    props.onPreview === undefined
      ? undefined
      : (css: string | null): void => {
          if (css === null) props.onPreview?.(null);
          else if (shadowRefusal(css) === undefined) props.onPreview?.(css);
        };
  const showsCss = asCss || reading.kind === "css";
  return (
    <div className="nx-shadow" role="group" aria-label={label}>
      <ShadowPreviews
        layers={reading.kind === "layers" ? reading.layers : undefined}
        value={value}
        tokens={tokens}
      />
      {showsCss ? (
        <CssView
          id={id}
          label={label}
          value={value}
          readOnly={readOnly}
          kept={reading.kind === "css"}
          refusal={refusal}
          refusedBy={props.refusedBy}
          onPreview={preview}
          onCommit={typed => {
            // Read back into the fields where it can be; kept as CSS where not.
            if (write(typed) && readShadow(typed, tokens).kind === "layers") {
              setAsCss(false);
            }
          }}
        />
      ) : (
        <LayerList
          layers={reading.kind === "layers" ? reading.layers : []}
          tokens={tokens}
          readOnly={readOnly}
          writesOf={props.writesOf}
          refusal={refusal}
          refusalId={`${id}-said`}
          onLayers={layers => write(writeShadow(layers, tokens))}
          onPreview={
            preview === undefined
              ? undefined
              : layers =>
                  preview(layers === null ? null : writeShadow(layers, tokens))
          }
          onEditAsCss={() => setAsCss(true)}
        />
      )}
      {names === undefined ? null : (
        <CssNamesLine id={`${id}-css`} names={names} />
      )}
    </div>
  );
}

/**
 * The preview cards: the shadow in light, and in dark where a colour it uses
 * has a dark value, each on the site's own background for that mode.
 */
function ShadowPreviews({
  layers,
  value,
  tokens,
}: {
  layers: readonly ShadowLayer[] | undefined;
  value: string;
  tokens: SiteTokenSet | undefined;
}): React.JSX.Element {
  const modes: TokenMode[] =
    layers !== undefined && shadowFollowsDark(layers, tokens)
      ? ["light", "dark"]
      : ["light"];
  return (
    <div className="nx-shadow__previews" aria-hidden="true">
      {modes.map(mode => (
        <span key={mode} className="nx-shadow__preview">
          <span
            className="nx-shadow__card"
            data-mode={mode}
            style={{
              // CSS the fields can't show is drawn as it is.
              boxShadow:
                layers === undefined
                  ? value
                  : shadowPreview(layers, tokens, mode),
              background: variableFor("color.background", tokens, mode)?.swatch,
            }}
          />
          <span className="nx-shadow__mode">
            {mode === "light" ? "Light" : "Dark"}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The shadow as the CSS it is stored as, in one field. */
function CssView({
  id,
  label,
  value,
  readOnly,
  kept,
  refusal,
  refusedBy,
  onPreview,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  readOnly: boolean;
  /** Whether it is CSS because the fields can't show it. */
  kept: boolean;
  refusal: string | undefined;
  refusedBy: string | undefined;
  onPreview: ((css: string | null) => void) | undefined;
  onCommit: (typed: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const saidId = `${id}-said`;
  const commit = (text: string): void => {
    const typed = text.trim();
    if (!readOnly && typed !== "") onCommit(typed);
    // Nothing to write: the edit is over all the same.
    else onPreview?.(null);
  };
  return (
    <div className="nx-shadow__css">
      <textarea
        className="nx-shadow__css-field nx-vars-editor__mono"
        aria-label={`${label} as CSS`}
        rows={3}
        spellCheck={false}
        readOnly={readOnly}
        value={draft}
        aria-invalid={
          refusal === undefined && refusedBy === undefined ? undefined : true
        }
        aria-describedby={refusal === undefined ? refusedBy : saidId}
        onChange={event => {
          const typed = event.currentTarget.value;
          setDraft(typed);
          if (!readOnly && typed.trim() !== "") onPreview?.(typed.trim());
        }}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          // Enter commits; Shift+Enter is a new line, for a long shadow.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
      {kept ? <p className="nx-shadow__note">{KEPT_AS_CSS}</p> : null}
      {refusal === undefined ? null : (
        <p className="nx-shadow__refusal" id={saidId} role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/** Every layer's fields, then "+ Add layer" and "Edit as CSS". */
function LayerList({
  layers,
  tokens,
  readOnly,
  writesOf,
  refusal,
  refusalId,
  onLayers,
  onPreview,
  onEditAsCss,
}: {
  layers: readonly ShadowLayer[];
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  writesOf: ((css: string) => string) | undefined;
  refusal: string | undefined;
  refusalId: string;
  onLayers: (layers: readonly ShadowLayer[]) => void;
  /** Draws the layers as one is edited; `null` ends it. */
  onPreview: ((layers: readonly ShadowLayer[] | null) => void) | undefined;
  onEditAsCss: () => void;
}): React.JSX.Element {
  const writes = writesOf?.(writeShadow(layers, tokens));
  const change = (at: number, layer: ShadowLayer): void =>
    onLayers(layers.map((each, index) => (index === at ? layer : each)));
  const move = (at: number, by: -1 | 1): void => {
    const next = [...layers];
    const [moved] = next.splice(at, 1);
    if (moved !== undefined) next.splice(at + by, 0, moved);
    onLayers(next);
  };
  return (
    <>
      {layers.map((layer, index) => (
        <LayerFields
          // Layers have no identity of their own; their place is it.
          key={index}
          index={index}
          count={layers.length}
          layer={layer}
          tokens={tokens}
          readOnly={readOnly}
          writes={writes}
          onChange={next => change(index, next)}
          onPreview={
            onPreview === undefined
              ? undefined
              : next =>
                  onPreview(
                    next === null
                      ? null
                      : layers.map((each, at) => (at === index ? next : each))
                  )
          }
          onMove={by => move(index, by)}
          onRemove={() => onLayers(layers.filter((_, at) => at !== index))}
        />
      ))}
      {refusal === undefined ? null : (
        <p className="nx-shadow__refusal" id={refusalId} role="alert">
          {refusal}
        </p>
      )}
      {readOnly ? null : (
        <div className="nx-shadow__actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="nx-vars-editor__button"
            onClick={() => onLayers([...layers, NEW_SHADOW_LAYER])}
          >
            + Add layer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="nx-vars-editor__button"
            onClick={onEditAsCss}
          >
            Edit as CSS
          </Button>
        </div>
      )}
    </>
  );
}

/** The sizes a layer has, each with its field's label. */
const SIZES = [
  ["x", "X offset"],
  ["y", "Y offset"],
  ["blur", "Blur"],
  ["spread", "Spread"],
] as const;

/** One layer: its four sizes, its Colour and Inside, and its actions. */
function LayerFields({
  index,
  count,
  layer,
  tokens,
  readOnly,
  writes,
  onChange,
  onPreview,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  layer: ShadowLayer;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  writes: string | undefined;
  onChange: (layer: ShadowLayer) => void;
  /** Draws the layer as one of its fields is edited; `null` ends it. */
  onPreview: LayerPreview | undefined;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const name = `Layer ${String(index + 1)}`;
  return (
    <div className="nx-shadow__layer" role="group" aria-label={name}>
      <div className="nx-shadow__layer-head">
        <span className="nx-shadow__layer-name">{name}</span>
        {readOnly ? null : (
          <LayerActions
            name={name.toLowerCase()}
            first={index === 0}
            last={index === count - 1}
            onMove={onMove}
            onRemove={onRemove}
          />
        )}
      </div>
      <div className="nx-shadow__sizes">
        {SIZES.map(([part, label]) => (
          <Hinted key={part} writes={writes}>
            <SizeValue
              label={label}
              value={layer[part] ?? ""}
              // An unset blur or spread draws as 0.
              placeholder="0"
              readOnly={readOnly}
              onCommit={typed => onChange({ ...layer, [part]: typed })}
              {...(onPreview === undefined
                ? {}
                : {
                    onPreview: (typed: string | null) =>
                      onPreview(
                        typed === null ? null : { ...layer, [part]: typed }
                      ),
                  })}
            />
          </Hinted>
        ))}
      </div>
      <Hinted writes={writes}>
        <LayerColour
          layer={name.toLowerCase()}
          colour={layer.colour}
          tokens={tokens}
          readOnly={readOnly}
          onColour={colour => onChange({ ...layer, colour })}
          {...(onPreview === undefined
            ? {}
            : {
                onPreviewColour: (colour: ShadowColour | undefined) =>
                  onPreview({ ...layer, colour }),
              })}
        />
      </Hinted>
      <Hinted writes={writes}>
        <label className="nx-shadow__inside">
          <Switch
            aria-label="Inside"
            checked={layer.inset}
            disabled={readOnly}
            onCheckedChange={inset => onChange({ ...layer, inset })}
          />
          <span aria-hidden="true">Inside</span>
        </label>
      </Hinted>
    </div>
  );
}

/** A field with the declaration it writes on hover, where one is said. */
function Hinted({
  writes,
  children,
}: {
  writes: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <CssHint writes={writes}>
      <div className="nx-shadow__field">{children}</div>
    </CssHint>
  );
}

/** Move up, Move down and Remove, named for the layer. */
function LayerActions({
  name,
  first,
  last,
  onMove,
  onRemove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <span className="nx-shadow__layer-actions">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={first}
        aria-label={`Move ${name} up`}
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={last}
        aria-label={`Move ${name} down`}
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </span>
  );
}

/**
 * A layer's Colour, through the block panel's own colour picker: the site's
 * colour variables first, then a colour of its own.
 */
function LayerColour({
  layer,
  colour,
  tokens,
  readOnly,
  onColour,
  onPreviewColour,
}: {
  /** The layer's name, which the picker's controls are named for. */
  layer: string;
  colour: ShadowColour | undefined;
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  onColour: (colour: ShadowColour | undefined) => void;
  /**
   * Draws a colour typed or picked before it is written. Given, the field
   * types live into it, and its commit still writes once.
   */
  onPreviewColour?: (colour: ShadowColour | undefined) => void;
}): React.JSX.Element {
  const id = React.useId();
  const stored = storedColour(colour);
  return (
    <div className="nx-shadow__colour">
      <label className="nx-vars-editor__label" id={`${id}-label`} htmlFor={id}>
        Colour
      </label>
      {readOnly || SHADOW_COLOUR_CONTROL === undefined ? (
        <input
          id={id}
          className="nx-vars-editor__mono"
          readOnly
          value={typeof stored === "string" ? stored : ""}
        />
      ) : (
        <TypesLive on={onPreviewColour !== undefined}>
          <ColourField
            id={id}
            labelledBy={`${id}-label`}
            control={SHADOW_COLOUR_CONTROL}
            stored={stored}
            actionName={layer}
            tokens={tokens}
            prefersDark={false}
            pairedColour={undefined}
            obscuredBy={undefined}
            describedBy={undefined}
            onCommit={next => {
              onColour(colourOf(next));
              return "applied";
            }}
            {...(onPreviewColour === undefined
              ? {}
              : {
                  onType: (next: StyleValue | null) => {
                    onPreviewColour(colourOf(next));
                    return "applied" as const;
                  },
                })}
          />
        </TypesLive>
      )}
    </div>
  );
}

/**
 * Fields drawn as typing live where `on`, as a previewed shadow's are, and as
 * the panel around them says otherwise.
 */
function TypesLive({
  on,
  children,
}: {
  on: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return on ? (
    <TypesLiveContext.Provider value={true}>
      {children}
    </TypesLiveContext.Provider>
  ) : (
    <>{children}</>
  );
}

/** A layer's colour as the colour picker stores one. */
function storedColour(
  colour: ShadowColour | undefined
): StyleValue | undefined {
  if (colour === undefined) return undefined;
  return colour.kind === "variable" ? tokenRef(colour.identity) : colour.value;
}

/** What the colour picker chose, as a layer's colour. */
function colourOf(value: StyleValue | null): ShadowColour | undefined {
  if (isTokenRef(value)) return { kind: "variable", identity: value.$token };
  return typeof value === "string" && value.trim() !== ""
    ? { kind: "raw", value: value.trim() }
    : undefined;
}
