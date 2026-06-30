"use client";

import type { ReactNode } from "react";

import { PluginSlot } from "../plugin-slot";

interface PluginPageHostProps {
  /** Component path resolved via the registry (D19). */
  componentPath: string;
  params?: Record<string, string | string[]>;
  searchParams?: Record<string, string | string[] | undefined>;
}

/**
 * Renders a plugin custom page (D21). The router resolves the namespaced path
 * to a `componentPath`; this host renders it via `PluginSlot` (resolution +
 * error isolation, D53). RBAC + layout are applied by the router/RootLayout
 * (the route carries `requiredPermission` + `routeType: "private"`).
 */
export function PluginPageHost({
  componentPath,
  params,
  searchParams,
}: PluginPageHostProps): ReactNode {
  return <PluginSlot path={componentPath} props={{ params, searchParams }} />;
}
