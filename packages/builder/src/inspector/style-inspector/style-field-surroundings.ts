"use client";

/**
 * What every part of the Style tab reads: the surroundings a field is drawn
 * in, the address an edit is made at, where a control's value came from,
 * what a commit answers, and the contexts that carry the edited target, the
 * token prefix, the value applied at another tier and a form toggle drawn
 * above a field.
 *
 * @module style-field-surroundings
 */
import {
  DEFAULT_TOKEN_PREFIX,
  type BreakpointId,
  type BreakpointSet,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import type { PageStyleCascade } from "@nextlyhq/blocks-react";
import * as React from "react";

import type { EditorState } from "../../editor-state";
import type { SideOrientation } from "../../side-orientation";
import type { BreakpointBadge, StyleProvenance } from "../../style-provenance";
import type { StylePolicy } from "../../style-values";

import type { StyleTarget } from "./style-target";

/** What one control knows about where its value came from, and what to do. */
export interface ProvenanceAnswer {
  provenance: StyleProvenance;
  badge: BreakpointBadge;
  /**
   * Move the canvas to the tier this control's value came from.
   *
   * Carried per LEAF rather than threaded as its own prop, because the
   * target is this control's own source: a different control on the same
   * panel jumps somewhere else. Bundling it here also keeps three
   * intermediate components from gaining a prop they only pass on.
   *
   * Absent when the host supplies no handler, which is a host that cannot
   * move its canvas — and a button that does nothing reads as broken rather
   * than as missing.
   */
  jump?: () => void;
  /**
   * What the control would show without the block's own value at the
   * position being edited, judged at the edited tier: the source the
   * "overrides" line names, and what its Reset shows again.
   */
  beneath: StyleProvenance;
}

/**
 * Where one control's value came from, asked per control against a subject and a
 * trace the panel resolved ONCE.
 *
 * A function rather than a precomputed map because the key would have to be the
 * control's CSS property AND its descendant selector — the catalog writes
 * `color` from three different controls — and a map keyed on that pair is a
 * second spelling of the filter `styleProvenance` already applies.
 *
 * `undefined` means nothing can answer, which is not the same as "unset".
 */
export type ProvenanceOf = (leaf: StyleLeaf) => ProvenanceAnswer | undefined;

/** Editing the block itself, wearing nothing: the target when none is given. */
export const BLOCK_TARGET: StyleTarget = { kind: "block", worn: [] };

/**
 * What the controls edit, for the field that reads and writes a value.
 *
 * A context rather than one more prop threaded through every section and row
 * between the panel and the field: none of them reads it.
 */
export const StyleTargetContext: React.Context<StyleTarget> =
  React.createContext<StyleTarget>(BLOCK_TARGET);

/**
 * Whether the style fields drawn here write as they are typed, so the canvas
 * follows each keystroke. A block's own fields do, and the panels that draw
 * them say so: off by default, so a field reused elsewhere still writes only
 * when it is left. A site variable's size or a shadow variable's colour turns
 * it on with a write of its own for the keystrokes (the field's `onType`),
 * which draws the value on the canvas and stores nothing: a variable is
 * stored once, when its edit ends, as a change to every page that uses it
 * should be.
 */
export const TypesLiveContext: React.Context<boolean> =
  React.createContext<boolean>(false);

/**
 * The prefix the cascade's token references were written under, for a reader
 * matching a value reaching from elsewhere to one token exactly; the default
 * prefix while no cascade answers.
 */
export const TokenPrefixContext: React.Context<string> =
  React.createContext<string>(DEFAULT_TOKEN_PREFIX);

/** The cascade's token prefix, or the default while no cascade answers. */
export function tokenPrefixOf(cascade: PageStyleCascade | undefined): string {
  return cascade?.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
}

/**
 * Everything a style field needs from the panel around it.
 *
 * Named once because the section and the property list pass the identical set
 * down, and two copies of ten props drift the moment one gains an eleventh —
 * silently, since the section would simply stop forwarding what it no longer
 * declares.
 */
export interface StyleFieldSurroundings {
  /**
   * How the edited element runs, or `undefined` when the canvas could not say.
   *
   * Only the per-side box reads it, and `undefined` means NOT KNOWN rather than
   * left-to-right: a box drawn on an unknown orientation is a positional claim
   * with nothing behind it.
   */
  orientation: SideOrientation | undefined;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
  policy: StylePolicy | undefined;
  tokens: SiteTokenSet | undefined;
  prefersDark: boolean;
  provenanceOf: ProvenanceOf;
  editing: EditedAddress;
  onChooseForm: ChooseForm;
  /** The site's devices, for a control that writes at another one. */
  breakpoints: BreakpointSet | undefined;
}

/**
 * What the cascade applies to the edited block at another tier, lent to a
 * control that writes at tiers other than the one being edited (where a row
 * stacks). Absent where the host compiles no cascade.
 */
export const AppliedAtTier: React.Context<CascadeAt | undefined> =
  React.createContext<CascadeAt | undefined>(undefined);

/**
 * What the cascade applies to the edited block at a tier beneath its own
 * values, for a control that clears one and must undo what lies beneath.
 * Absent where the host compiles no cascade.
 */
export const BeneathAtTier: React.Context<CascadeAt | undefined> =
  React.createContext<CascadeAt | undefined>(undefined);

/**
 * What the cascade applies to the edited block at a tier, for any CSS
 * property: the value, the tier that sets it, and whether the block itself
 * stores it. `undefined` where nothing sets it.
 */
export type CascadeAt = (
  tier: string,
  cssProperty: string
) => { value: string; breakpoint: string; own: boolean } | undefined;

/**
 * Whether this field's form toggle is drawn just above it. A single control
 * there keeps its label for assistive technology and drops the visible copy:
 * the toggle's row already says the name.
 */
export const NamedAbove: React.Context<boolean> = React.createContext(false);

/** How an author says which form they mean to write a value in. */
export type ChooseForm = (
  property: string,
  path: readonly string[],
  arm: number
) => void;

/**
 * What a commit did to the document.
 *
 * Three outcomes rather than a boolean, because the surface showing the value
 * has to do something different in each and two of them are easy to conflate.
 * `refused` KEEPS what the author typed, so they can correct it beside the
 * message. `unchanged` means the write was valid and the document already held
 * that value — `01` where it holds `1` — so the field has to go back to what
 * the document says, and nothing else will make it: the stored value never
 * moved, so no effect keyed on it fires.
 */
export type CommitOutcome = "applied" | "refused" | "unchanged";

/** Which node, state and breakpoint the panel is editing, to say what DIFFERS. */
export interface EditedAddress {
  readonly nodeId: string;
  /** The selected block's type, to tell its own defaults from an ancestor's. */
  readonly blockType: string | undefined;
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
  /** A breakpoint's author-facing name, for saying which one a value came from. */
  readonly labelOf: (breakpoint: BreakpointId) => string;
  /**
   * A shared style's name by its class name, for saying a value comes from
   * it: "From Card". The class name itself when omitted or unknown.
   */
  readonly sharedStyleName?: (slug: string) => string | undefined;
  /**
   * A block's name as the Layers panel shows it, for saying which enclosing
   * block a value came from. Absent, it is "an enclosing block".
   */
  readonly nameOf?: (nodeId: string) => string | undefined;
}
