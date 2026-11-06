"use client";

/**
 * The editor's side of `POST /components/from-selection`: a dry run when the
 * form opens, and the write when the author confirms.
 *
 * @module admin/component-from-selection-client
 */
import type { BlockDocument, ComponentExposure } from "@nextlyhq/blocks-engine";
import { usePluginRouteMutation } from "@nextlyhq/plugin-sdk/admin";
import { useCallback } from "react";

// The CONTRACT, not the route: the route reaches the collection through
// server-only modules.
import {
  COMPONENT_FROM_SELECTION_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentFromSelectionAction,
  type ComponentFromSelectionFields,
  type ComponentFromSelectionRequest,
  type ComponentFromSelectionResult,
} from "../library-contract";

import { refusalMessage } from "./save-pattern-client";

/** What the route answers inside the mutation envelope. */
interface ComponentFromSelectionEnvelope {
  readonly message: string;
  readonly item: ComponentFromSelectionResult;
}

/** A request the editor makes: always `library`, since it holds the page. */
export interface ComponentFromSelectionAsk {
  readonly action: ComponentFromSelectionAction;
  readonly document: BlockDocument;
  readonly selectedIds: readonly string[];
  readonly fields: ComponentFromSelectionFields;
  readonly exposure?: ComponentExposure;
}

export interface ComponentFromSelectionWriter {
  /** The plan, written nowhere. */
  readonly preview: (
    ask: ComponentFromSelectionAsk
  ) => Promise<ComponentFromSelectionResult | undefined>;
  /** The write: the component created, and the page ops to apply. */
  readonly create: (
    ask: ComponentFromSelectionAsk
  ) => Promise<ComponentFromSelectionResult | undefined>;
  /** Why the last dry run was refused, in words, or `undefined`. */
  readonly previewError: string | undefined;
  /** Why the last create was refused, in words, or `undefined`. */
  readonly createError: string | undefined;
  readonly creating: boolean;
}

const UNEXPLAINED = "The component could not be created. Try again.";

/**
 * The route's two uses. Two writers rather than one, so a dry run in flight
 * never reports itself as the create's pending state.
 */
export function useComponentFromSelection(): ComponentFromSelectionWriter {
  const dry = usePluginRouteMutation<
    ComponentFromSelectionRequest,
    ComponentFromSelectionEnvelope
  >({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: COMPONENT_FROM_SELECTION_ROUTE_PATH,
  });
  const real = usePluginRouteMutation<
    ComponentFromSelectionRequest,
    ComponentFromSelectionEnvelope
  >({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: COMPONENT_FROM_SELECTION_ROUTE_PATH,
  });

  const send = useCallback(
    async (
      write: (
        body: ComponentFromSelectionRequest
      ) => Promise<ComponentFromSelectionEnvelope | undefined>,
      ask: ComponentFromSelectionAsk,
      dryRun: boolean
    ) => {
      const answered = await write({
        action: ask.action,
        apply: "library",
        dryRun,
        document: ask.document,
        selectedIds: ask.selectedIds,
        fields: ask.fields,
        ...(ask.exposure === undefined ? {} : { exposure: ask.exposure }),
      });
      return answered?.item;
    },
    []
  );

  const dryWrite = dry.write;
  const realWrite = real.write;
  const preview = useCallback(
    (ask: ComponentFromSelectionAsk) => send(dryWrite, ask, true),
    [send, dryWrite]
  );
  const create = useCallback(
    (ask: ComponentFromSelectionAsk) => send(realWrite, ask, false),
    [send, realWrite]
  );
  return {
    preview,
    create,
    previewError:
      dry.error === null ? undefined : refusalMessage(dry.error, UNEXPLAINED),
    createError:
      real.error === null ? undefined : refusalMessage(real.error, UNEXPLAINED),
    creating: real.pending,
  };
}
