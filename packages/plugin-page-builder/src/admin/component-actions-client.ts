"use client";

/**
 * The editor's side of the detach, duplicate and update-pattern routes. Each
 * hook is one route; a refusal is said in the words every composition
 * refusal uses.
 *
 * @module admin/component-actions-client
 */
import { usePluginRouteMutation } from "@nextlyhq/plugin-sdk/admin";
import { useCallback } from "react";

// The CONTRACT, not the route: the route reaches the collection through
// server-only modules.
import {
  DETACH_ROUTE_PATH,
  duplicatePath,
  updatePatternPath,
  type DetachRequest,
  type DetachResult,
  type DuplicateRequest,
  type DuplicateResult,
  type UpdatePatternRequest,
  type UpdatePatternResult,
} from "../component-actions-contract";
import {
  LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
} from "../library-contract";

import { refusalMessage } from "./save-pattern-client";

/** One route as the editor calls it: the write, and why it was refused. */
export interface RouteCall<TBody, TResult> {
  readonly send: (body: TBody) => Promise<TResult | undefined>;
  readonly error: string | undefined;
}

/** The canonical mutation envelope these routes answer with. */
interface Envelope<T> {
  readonly message: string;
  readonly item: T;
}

function useRouteCall<TBody, TResult>(
  path: string,
  unexplained: string,
  invalidates?: readonly string[]
): RouteCall<TBody, TResult> {
  const { write, error } = usePluginRouteMutation<TBody, Envelope<TResult>>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path,
    ...(invalidates === undefined ? {} : { invalidates }),
  });
  const send = useCallback(
    async (body: TBody) => (await write(body))?.item,
    [write]
  );
  return {
    send,
    error: error === null ? undefined : refusalMessage(error, unexplained),
  };
}

/** Detach a placement; the server writes nothing in library mode. */
export function useDetach(): RouteCall<DetachRequest, DetachResult> {
  return useRouteCall(
    DETACH_ROUTE_PATH,
    "It could not be detached from the component. Try again."
  );
}

/** Duplicate one component. */
export function useDuplicate(
  componentId: string
): RouteCall<DuplicateRequest, DuplicateResult> {
  return useRouteCall(
    duplicatePath(componentId),
    "The component could not be duplicated. Try again."
  );
}

/** Replace one pattern's content with a selection. */
export function useUpdatePattern(
  patternId: string
): RouteCall<UpdatePatternRequest, UpdatePatternResult> {
  // The insert panel's read, so a later insert serves the new content.
  return useRouteCall(
    updatePatternPath(patternId),
    "The pattern could not be updated. Try again.",
    [LIBRARY_ROUTE_PATH]
  );
}
