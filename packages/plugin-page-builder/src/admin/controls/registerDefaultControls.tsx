"use client";

/**
 * Registers the built-in inspector controls into the (open) control registry and exposes
 * `renderControl`, the generic dispatch the inspector uses to turn a control `type` +
 * ControlProps into a rendered React node. Third parties register novel controls the same
 * way — no core edit needed (spec §7). Registration is idempotent.
 */
import { createElement, type ReactNode } from "react";

import { defaultControlRegistry } from "../../core/registry";

import { ColorControl } from "./ColorControl";
import { MediaControl } from "./MediaControl";
import {
  AlignControl,
  BooleanControl,
  DimensionControl,
  LinkControl,
  NumberControl,
  SelectControl,
  TextControl,
  TextareaControl,
} from "./primitives";
import { SpacingControl } from "./SpacingControl";
import type { ControlComponent, ControlProps } from "./types";

const CONTROLS: Record<string, ControlComponent> = {
  text: TextControl,
  textarea: TextareaControl,
  number: NumberControl,
  boolean: BooleanControl,
  select: SelectControl,
  align: AlignControl,
  dimension: DimensionControl,
  link: LinkControl,
  spacing: SpacingControl,
  color: ColorControl,
  media: MediaControl,
};

let registered = false;

export function registerDefaultControls(): void {
  if (registered) return;
  registered = true;
  for (const [type, Component] of Object.entries(CONTROLS)) {
    defaultControlRegistry.register({ type, Component });
  }
}

/** Render a control by type. Falls back to a plain text control for unknown types. */
export function renderControl(type: string, props: ControlProps): ReactNode {
  const def = defaultControlRegistry.get(type);
  const Component =
    (def?.Component as ControlComponent | undefined) ?? TextControl;
  return createElement(Component, props);
}
