"use client";

/**
 * The spacing box as the Style tab draws it: margin the outer ring and
 * padding the inner, around the element, with each side's field in a frame.
 * Which properties form the box, and its keyboard order, live in
 * `spacing-box.tsx`.
 *
 * @module spacing-box-fields
 */
import { isTokenRef } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { StyleControl } from "../../style-controls";
import {
  physicalSideName,
  sideBoxFor,
  sideOf,
  type SideBox,
} from "../../style-sides";
import { readStyleValue } from "../../style-values";
import { fieldLabel } from "../inspector";

import { siteDefaultSource } from "./site-default-source";
import { CompactSides } from "./spacing-box";
import { SpacingRingContext } from "./spacing-side";
import { StyleControlField } from "./style-field-shell";
import {
  StyleTargetContext,
  TokenPrefixContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";
import { fieldStyles } from "./style-field-target";
import type { InspectedStyleProperty } from "./style-inspector";

/**
 * The element that carries the box arrangement, wrapping ONLY the four sides.
 *
 * Its own element rather than the property container, and that is the whole
 * point of it. The container also holds the property's heading, the form
 * selectors and the notice for a withdrawn property, and those must go on
 * reading in the PANEL's axes. Putting the edited element's `writing-mode` on
 * the container rotated everything inside it: in a vertical writing mode the
 * row reserved above the diagram becomes a physical column beside it, so the
 * heading ends up next to the box rather than over it, and the narrow fallback
 * — which stacks the sides with `flex-direction: column` — runs sideways.
 *
 * Scoped here, the axes reach exactly what they are about: the grid whose
 * columns and rows ARE the inline and block axes of the element being edited.
 *
 * A plain wrapper when there is no box, so the fields stay direct children of
 * the property in the ordinary case and nothing about the row layout changes.
 *
 * @param props - the settled box decision and the fields to place
 * @returns the sides, framed if they are a box
 */
export function SideBoxFrame({
  box,
  ring,
  children,
}: {
  box: SideBox;
  /** Which ring of the spacing box this is, when it is one. */
  ring?: "margin" | "padding";
  children: React.ReactNode;
}): React.JSX.Element {
  if (!box.boxed || box.axes === undefined) return <>{children}</>;
  return (
    <div
      className="nx-style-inspector__side-box"
      // Read by the stylesheet, which owns the arrangement.
      data-sides="logical"
      data-ring={ring}
      /*
       * The EDITED ELEMENT's axes, so this grid's own placement resolves in
       * them: columns run along the inline axis and rows along the block axis,
       * so column one is the inline start in either direction and a vertical
       * mode transposes the pair — with no table of physical edges written here
       * to keep in step with CSS.
       *
       * Passed as custom PROPERTIES rather than applied as `writing-mode` and
       * `direction` directly. An inline declaration outranks every selector, so
       * the stylesheet could then only take the axes back by shouting; handed
       * over as values, the property that uses them is set by a rule, and the
       * narrow fallback overrides it by ordinary cascade order.
       */
      style={
        {
          "--nx-side-writing-mode": box.axes.writingMode,
          "--nx-side-direction": box.axes.direction,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * The spacing section as the design draws it: one box, margin the outer ring
 * and padding the inner, around the element.
 *
 * Each side keeps its own field, so it commits on its own, undoes on its own,
 * and shows where its value comes from, exactly as a side drawn in a row does.
 * The box is the drawing alone.
 */
export function SpacingBox({
  margin,
  padding,
  surroundings,
}: {
  margin: InspectedStyleProperty | undefined;
  padding: InspectedStyleProperty;
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element {
  const inner = (
    <SpacingRing
      property={padding}
      ring="padding"
      surroundings={surroundings}
    />
  );
  const bound = useAnySideBound([margin, padding], surroundings);
  const siteDefault = useSiteDefaultSource(padding, surroundings);
  return (
    <div className="nx-spacing-box">
      <CompactSides.Provider value={true}>
        {margin === undefined ? (
          inner
        ) : (
          <SpacingRing
            property={margin}
            ring="margin"
            surroundings={surroundings}
          >
            <div className="nx-spacing-box__centre">{inner}</div>
          </SpacingRing>
        )}
      </CompactSides.Provider>
      {siteDefault === undefined ? null : (
        <p className="nx-spacing-box__note" data-site-default="">
          {siteDefault}
        </p>
      )}
      {bound ? (
        <p className="nx-spacing-box__note">
          Green values come from your spacing variables.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The site setting the padding comes from, once, under the box: "Site
 * default: Section spacing" on a new Section, whose padding reads the site's
 * section spacing variables. `undefined` when no side takes its value from a
 * site setting, or the sides take it from two.
 */
function useSiteDefaultSource(
  padding: InspectedStyleProperty,
  surroundings: StyleFieldSurroundings
): string | undefined {
  const tokenPrefix = React.useContext(TokenPrefixContext);
  const sources = new Set<string>();
  for (const control of padding.controls) {
    const provenance = surroundings.provenanceOf(control.leaf)?.provenance;
    if (provenance?.kind !== "inherited") continue;
    const source = siteDefaultSource(
      provenance.from,
      provenance.entry,
      tokenPrefix
    );
    if (source !== undefined) sources.add(source);
  }
  return sources.size === 1 ? [...sources][0] : undefined;
}

/** Whether any side of the box holds a variable, at the tier being edited. */
function useAnySideBound(
  properties: readonly (InspectedStyleProperty | undefined)[],
  surroundings: StyleFieldSurroundings
): boolean {
  const target = React.useContext(StyleTargetContext);
  const { styles } = fieldStyles(
    target,
    surroundings.editor,
    surroundings.nodeId
  );
  const { state, breakpoint } = surroundings;
  return properties.some(property =>
    (property?.controls ?? []).some(control =>
      isTokenRef(
        readStyleValue(styles, {
          state,
          breakpoint,
          property: control.property,
          path: control.path,
        })
      )
    )
  );
}

/** One ring of the spacing box: a property's four sides, and what it holds. */
function SpacingRing({
  property,
  ring,
  surroundings,
  children,
}: {
  property: InspectedStyleProperty;
  ring: "margin" | "padding";
  surroundings: StyleFieldSurroundings;
  children?: React.ReactNode;
}): React.JSX.Element {
  const { orientation, state, breakpoint } = surroundings;
  const box = sideBoxFor(property.controls, orientation);
  return (
    <div
      className="nx-style-inspector__property"
      data-property={property.property}
    >
      <SpacingRingContext.Provider value={box}>
        <SideBoxFrame box={box} ring={ring}>
          {/* Seen, not heard: every side's own name already says it. */}
          <span className="nx-spacing-box__caption" aria-hidden="true">
            {property.label}
          </span>
          {box.controls.map(control => {
            const name = spacingSideName(property, box, control);
            return (
              <StyleControlField
                key={[
                  state,
                  breakpoint,
                  property.property,
                  ...control.path,
                ].join(".")}
                control={control}
                side={sideOf(box, control)}
                label={name}
                summary={undefined}
                // The side's whole name, so its actions say "Reset Margin top"
                // rather than naming the property twice.
                propertyLabel={name}
                clearOnly={control.withheld}
                nodeId={surroundings.nodeId}
                state={state}
                breakpoint={breakpoint}
                editor={surroundings.editor}
                policy={surroundings.policy}
                tokens={surroundings.tokens}
                prefersDark={surroundings.prefersDark}
                provenanceOf={surroundings.provenanceOf}
                editing={surroundings.editing}
              />
            );
          })}
          {children}
        </SideBoxFrame>
      </SpacingRingContext.Provider>
    </div>
  );
}

/**
 * "Margin top": the property and the side in plain words, where the element's
 * axes give the side a physical name, and the logical one where they do not.
 */
function spacingSideName(
  property: InspectedStyleProperty,
  box: SideBox,
  control: StyleControl
): string {
  const side = sideOf(box, control);
  const physical =
    side === undefined || box.axes === undefined
      ? undefined
      : physicalSideName(side, box.axes);
  const sideName =
    physical ?? fieldLabel(control.path[control.path.length - 1] ?? "");
  return `${property.label} ${sideName.toLowerCase()}`;
}
