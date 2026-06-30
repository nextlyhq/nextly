"use client";

import type { ReactNode } from "react";

import {
  getComponent,
  type ComponentPath,
} from "../../../lib/plugins/component-registry";
import { PluginComponentBoundary } from "../plugin-component-boundary";

interface PluginSlotProps {
  /** Component path to resolve via the registry. */
  path: ComponentPath | undefined;
  /** Props forwarded to the resolved component. */
  props?: Record<string, unknown>;
  /** Rendered when `path` is empty or unresolved (plugin not installed/registered). */
  fallback?: ReactNode;
}

/**
 * Resolves a plugin component by `ComponentPath` and renders it inside a
 * `PluginComponentBoundary` (D19 + D53).
 *
 * - Unresolved (no path / not registered) → `fallback` (default: nothing).
 * - Resolved → rendered, isolated so a throw shows the boundary's identifiable
 *   fallback rather than white-screening the page.
 */
export function PluginSlot({
  path,
  props,
  fallback,
}: PluginSlotProps): ReactNode {
  const Component = getComponent(path);
  if (!Component) {
    return fallback ?? null;
  }
  return (
    <PluginComponentBoundary componentPath={path as string}>
      <Component {...(props ?? {})} />
    </PluginComponentBoundary>
  );
}
