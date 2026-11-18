"use client";

/**
 * The inspector's Style tab: the bar that says what an edit changes, on which
 * device and in which state, then the style controls themselves. While a
 * state other than Normal is edited, the controls sit on a tint of the
 * state's amber under a line that says so, so an author scrolled deep into
 * the tab still sees they are not editing the normal look.
 *
 * @module inspector-style-tab
 */

import {
  BASE_BREAKPOINT,
  breakpointContexts,
  type BreakpointId,
  type BreakpointSet,
  type NodeStyles,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { useCanvasTokenModeAt } from "./canvas/prefers-dark";
import { stateLookLine } from "./editing-bar";
import { FocalFrame } from "./focal-frame";
import type { selectedNode } from "./inspector";
import type {
  InspectorPanelProps,
  StyleStateBinding,
} from "./inspector-panel-types";
import { editedStyleState } from "./inspector-style-state";
import { blockStyleTilesOf } from "./look-tiles-view";
import { FirstSectionAbove } from "./panel-folds-context";
import { deviceOptions, tierIcon } from "./shell/breakpoint-switcher";
import { StyleStateField } from "./state-switcher";
import {
  breakpointLabel,
  StyleInspectorPanel,
  type StyleInspectorPanelProps,
} from "./style-inspector-panel";
import { StyleTargetBar, useStyleTarget } from "./style-target";

/**
 * Where an edit lands, as the bar's device chip says it: the device the top
 * bar shows, named and drawn as the top bar names and draws it, and the
 * devices the value reaches, in words rather than as a breakpoint's id.
 */
function barPlace(
  breakpoints: BreakpointSet | undefined,
  breakpoint: BreakpointId | undefined
): {
  device: string;
  deviceReach: string;
  deviceIcon: React.ComponentType<{ className?: string }>;
} {
  const id = breakpoint ?? BASE_BREAKPOINT;
  // The top bar's own list, so the chip says what the switcher says; a
  // container tier, which it does not offer, goes by its definition's label.
  const option = deviceOptions(breakpoints).find(each => each.id === id);
  return {
    device: option?.label ?? breakpointLabel(breakpoints, id),
    deviceReach: editReach(breakpoints, id),
    // The base is drawn as a screen, as the top bar draws it.
    deviceIcon: tierIcon(id === BASE_BREAKPOINT ? undefined : option?.preview),
  };
}

/**
 * The State menu the bar carries, bound to the host's choice, or nothing when
 * the host cannot act on one. Its dots read the TARGET's styles (the block's,
 * or the shared style being edited), so a state is marked where the edit goes.
 */
function stateControlFor(
  state: StyleState,
  styleState: StyleStateBinding | undefined,
  holder: { styles?: NodeStyles } | null,
  breakpoints: BreakpointSet | undefined
): React.JSX.Element | undefined {
  if (styleState?.onChange === undefined) return undefined;
  return (
    <StyleStateField
      state={state}
      onSelect={styleState.onChange}
      node={holder}
      breakpoints={breakpoints}
    />
  );
}

/**
 * The Style tab: the bar that says what an edit changes, then the style
 * controls themselves.
 */
export function StyleTab({
  editor,
  styleNode,
  renderedTag,
  renderedPicture,
  renderedPicturePosition,
  sideOrientation,
  styleState,
  policy,
  breakpoint,
  cascade,
  breakpoints,
  previewContainer,
  liveBreakpoints,
  onJumpToBreakpoint,
  tokens,
  fonts,
  // The bar's own inputs, kept together: the library, the host and the verbs.
  ...shared
}: Pick<
  InspectorPanelProps,
  | "editor"
  | "styleState"
  | "policy"
  | "breakpoint"
  | "cascade"
  | "breakpoints"
  | "previewContainer"
  | "liveBreakpoints"
  | "onJumpToBreakpoint"
  | "tokens"
  | "classLibrary"
  | "classLibraryAbsence"
  | "sharedStyles"
  | "verbs"
  | "fonts"
  | "onEditBlockStyles"
> & {
  styleNode: ReturnType<typeof selectedNode>;
  renderedTag: StyleInspectorPanelProps["renderedTag"];
  renderedPicture: string | undefined;
  renderedPicturePosition: string | undefined;
  sideOrientation: StyleInspectorPanelProps["sideOrientation"];
}): React.JSX.Element {
  const state = editedStyleState(styleState);
  // ONE holder of what an edit changes, read by the bar and the controls.
  const { target, choose, held } = useStyleTarget(
    editor,
    shared.classLibrary,
    shared.sharedStyles
  );
  // The mode the selected block is drawn in, read once for the look tiles and
  // the controls below, so the canvas is watched by one subscription.
  const tokenMode = useCanvasTokenModeAt(editor.selectedId);
  return (
    // The picture the canvas draws for the block: the Block style tiles in
    // the bar draw it in each shape, and the focal point is aimed over it.
    <FocalFrame.Provider
      value={{
        picture: renderedPicture,
        position: renderedPicturePosition,
      }}
    >
      {/*
      ABOVE the controls, because it decides what every one of them reads
      and writes. Below them it would be a filter applied after the fact,
      and an author would have edited a value before meeting the thing
      that says which state the value belongs to.
    */}
      <StyleTargetBar
        editor={editor}
        tokens={tokens}
        tokenMode={tokenMode}
        target={target}
        onChoose={choose}
        held={held}
        library={shared.classLibrary}
        libraryAbsence={shared.classLibraryAbsence}
        host={shared.sharedStyles}
        verbs={shared.verbs}
        // "Edit block styles", under the Block style tiles, where the host
        // can open Design.
        onEditBlockStyles={shared.onEditBlockStyles}
        {...barPlace(breakpoints, breakpoint)}
        breakpoints={breakpoints}
        state={state}
        stateControl={stateControlFor(
          state,
          styleState,
          target.kind === "shared" ? target.style : styleNode,
          breakpoints
        )}
      />
      {/* The Block style section above the bar is the tab's first where it
        is drawn, so the first section under the bar does not also open for
        being first. */}
      <FirstSectionAbove.Provider
        value={blockStyleTilesOf(editor, shared.classLibrary) !== undefined}
      >
        <StateTinted state={state}>
          <StyleInspectorPanel
            editor={editor}
            tokenMode={tokenMode}
            // The block card above says why a held block can't be changed.
            showReadOnlyReason={false}
            renderedTag={renderedTag}
            sideOrientation={sideOrientation}
            policy={policy}
            state={state}
            breakpoint={breakpoint}
            cascade={cascade}
            breakpoints={breakpoints}
            previewContainer={previewContainer}
            liveBreakpoints={liveBreakpoints}
            onJumpToBreakpoint={onJumpToBreakpoint}
            tokens={tokens}
            target={target}
            fonts={fonts}
          />
        </StateTinted>
      </FirstSectionAbove.Provider>
    </FocalFrame.Provider>
  );
}

/**
 * The Style tab's sections, on a tint of the state's colour under a line
 * that names the state while one other than Normal is edited: the bar can
 * scroll far from a control, and the words stay beside it.
 */
function StateTinted({
  state,
  children,
}: {
  state: StyleState;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="nx-style-tab__body" data-state={state}>
      {state === "base" ? null : (
        <p className="nx-style-tab__state-line" data-editing-state-line="">
          {stateLookLine(state)}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The devices an edit at one tier reaches: the unconditional tier reaches
 * "All devices"; a narrower one reaches itself and every narrower one on its
 * axis ("Tablet and smaller"), or only itself when it is the narrowest
 * ("Mobile"). Read from the site's own breakpoints in the engine's order
 * (`breakpointContexts`: each axis widest first), named by each definition's
 * own label, so a site with its own breakpoints is described in its words.
 */
function editReach(
  breakpoints: BreakpointSet | undefined,
  id: BreakpointId
): string {
  if (id === BASE_BREAKPOINT) return "All devices";
  const contexts = breakpointContexts(breakpoints);
  const at = contexts.findIndex(context => context.id === id);
  const label = breakpointLabel(breakpoints, id);
  if (at === -1) return label;
  const axis = contexts[at]?.axis;
  const narrower = contexts
    .slice(at + 1)
    .some(context => context.axis === axis);
  return narrower ? `${label} and smaller` : label;
}
