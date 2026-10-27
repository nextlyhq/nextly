"use client";

import type { ReactNode } from "react";

import {
  getComponent,
  type ComponentPath,
} from "../../../lib/plugins/component-registry";
import { PluginComponentBoundary } from "../plugin-component-boundary";

/**
 * Generic over the props so a caller holding a typed object — a view's
 * declared props interface — passes it as it is, rather than widening it to a
 * record through a double cast that would also accept anything else.
 */
interface PluginSlotProps<P extends object> {
  /** Component path to resolve via the registry. */
  path: ComponentPath | undefined;
  /** Props forwarded to the resolved component. */
  props?: P;
  /** Rendered when `path` is empty or unresolved (plugin not installed/registered). */
  fallback?: ReactNode;
  /**
   * Rendered in place of the component when it throws while drawing; the
   * boundary's own identifiable message when absent. A dashboard card passes
   * its error state, so a throw reads as that card's failure, with its Retry.
   */
  errorFallback?: ReactNode;
  /**
   * Told when the component throws while drawing, so a host that draws the
   * failure itself (a dashboard card's frame) can.
   */
  onError?: () => void;
}

/**
 * Resolves a plugin component by `ComponentPath` and renders it inside a
 * `PluginComponentBoundary` (D19 + D53).
 *
 * - Unresolved (no path / not registered) → `fallback` (default: nothing).
 * - Resolved → rendered, isolated so a throw shows the boundary's identifiable
 *   fallback rather than white-screening the page.
 */
export function PluginSlot<P extends object = Record<string, unknown>>({
  path,
  props,
  fallback,
  errorFallback,
  onError,
}: PluginSlotProps<P>): ReactNode {
  // Resolved as taking `Partial<P>`: `props` is optional here, so the
  // component is told the truth that it may be rendered with none of them.
  // The registry is keyed by string and cannot check the component against
  // `P` at all; that trust lives in `getComponent`, not in a cast here.
  const Component = getComponent<Partial<P>>(path);
  if (!Component) {
    return fallback ?? null;
  }
  return (
    <PluginComponentBoundary
      componentPath={path as string}
      {...(errorFallback === undefined ? {} : { fallback: errorFallback })}
      {...(onError === undefined ? {} : { onError })}
    >
      <Component {...props} />
    </PluginComponentBoundary>
  );
}
