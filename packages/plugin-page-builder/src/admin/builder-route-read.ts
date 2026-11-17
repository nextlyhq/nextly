"use client";

/**
 * `usePluginRoute`, for a read the builder opens on: while the builder's
 * start-up read holds this read's answer (`startup-reads`), the hook shows it
 * and sends nothing; otherwise, and once the hook asks again, it is
 * `usePluginRoute` itself, with the caller's own options.
 *
 * @module admin/builder-route-read
 */
import {
  usePluginRoute,
  type PluginRouteRead,
  type PluginRouteRequest,
} from "@nextlyhq/plugin-sdk/admin";

import { useStartedAnswer } from "./startup-reads";

/** Read one of this plugin's routes the builder opens on. */
export function useBuilderRoute<T extends object | null>(
  request: PluginRouteRequest
): PluginRouteRead<T> {
  const enabled = request.enabled ?? true;
  const { answer, release } = useStartedAnswer<T>(request.path, enabled);
  const read = usePluginRoute<T>(
    answer.kind === "none" ? request : { ...request, enabled: false }
  );
  if (answer.kind === "none") return read;
  const pending = answer.kind === "pending";
  return {
    data: answer.kind === "answered" ? answer.body : undefined,
    pending,
    error: null,
    // Asked again: the route, as the hook always reads it.
    refetch: release,
    fetching: pending,
  };
}
