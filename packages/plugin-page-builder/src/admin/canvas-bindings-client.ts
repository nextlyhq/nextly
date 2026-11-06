"use client";

/**
 * The canvas's binding sources: what the bound props on the page being edited
 * read, read through the canvas bindings route as the person editing reads
 * them, and handed to the renderer as `PageBindings`.
 *
 * The canvas works out what its bindings read from the document it draws
 * (`bindingDemand`, the published page's own walk) and asks only for that,
 * so a page with no binding asks nothing. Asked again only when what the
 * bindings read changes, not on every keystroke, and kept a few seconds so
 * the page drawn again for a selection does not read again.
 *
 * Kept per signed-in person: the values are theirs, drafts included, so the
 * moment another person asks in the same tab (a sign-out and a sign-in),
 * every earlier person's kept reads are dropped before anything is answered.
 *
 * @module canvas-bindings-client
 */
import { bindingDemand, type BlockDocument } from "@nextlyhq/blocks-engine";
import { bindingsFromWire, type PageBindings } from "@nextlyhq/blocks-react";
import {
  useCurrentUserId,
  useDocumentIdentity,
  writePluginRoute,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useMemo, useState } from "react";

import {
  CANVAS_BINDINGS_ROUTE_PATH,
  demandToWire,
  type CanvasBindingsRequest,
  type CanvasBindingsResponse,
} from "../canvas-bindings-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** No source read: what the canvas draws with until an answer arrives. */
const NONE: PageBindings = Object.freeze({});

/** How long an answer is kept for the same ask. */
const KEPT_FOR_MS = 15_000;

/** The asks answered so far, by ask, for the current person only. */
const KEPT = new Map<string, { at: number; read: Promise<PageBindings> }>();
/** The person whose answers `KEPT` holds. */
let keptFor: string | null | undefined;

/**
 * What the canvas asks for the document it draws, or nothing when it holds no
 * binding or has no entry to read for.
 */
export function canvasBindingsRequest(
  document: BlockDocument,
  identity: DocumentIdentity | null,
  locale: string | undefined
): CanvasBindingsRequest | undefined {
  if (identity === null) return undefined;
  const demand = bindingDemand([document]);
  if (!demand.any) return undefined;
  return {
    source: {
      kind: identity.kind,
      slug: identity.slug,
      ...(identity.documentId === undefined ? {} : { id: identity.documentId }),
    },
    demand: demandToWire(demand),
    ...(locale === undefined ? {} : { locale }),
  };
}

/** One ask of the route. */
async function askRoute(
  request: CanvasBindingsRequest
): Promise<CanvasBindingsResponse> {
  const body = await writePluginRoute<CanvasBindingsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: CANVAS_BINDINGS_ROUTE_PATH,
    method: "POST",
    body: request,
  });
  if (body === undefined || !Array.isArray(body.singles)) {
    throw new Error("The canvas's binding sources could not be read.");
  }
  return body;
}

/**
 * The sources an ask names, for `userId`: from the answers kept for that
 * person, or asked afresh. Another person's answers are dropped first.
 */
export function canvasBindingsFor(
  request: CanvasBindingsRequest,
  userId: string | null,
  ask: (
    request: CanvasBindingsRequest
  ) => Promise<CanvasBindingsResponse> = askRoute
): Promise<PageBindings> {
  if (keptFor !== userId) {
    KEPT.clear();
    keptFor = userId;
  }
  const key = JSON.stringify(request);
  const kept = KEPT.get(key);
  if (kept !== undefined && Date.now() - kept.at < KEPT_FOR_MS) {
    return kept.read;
  }
  const reading = ask(request).then(bindingsFromWire);
  KEPT.set(key, { at: Date.now(), read: reading });
  // A failed ask is not kept, so the next draw asks again.
  reading.catch(() => {
    if (KEPT.get(key)?.read === reading) KEPT.delete(key);
  });
  return reading;
}

/**
 * The binding sources the canvas draws `document` with, as the person editing
 * reads them. Until the first answer arrives, and for a page with no binding,
 * no source is read: bound props keep their own values or fallbacks, as the
 * canvas always drew them. While a changed ask is answered, the previous
 * answer is kept, so bound values do not blink to their fallbacks.
 */
export function useCanvasBindings(
  document: BlockDocument,
  locale: string | undefined
): PageBindings {
  const identity = useDocumentIdentity();
  const userId = useCurrentUserId();
  const request = useMemo(
    () => canvasBindingsRequest(document, identity, locale),
    [document, identity, locale]
  );
  // The ask as text: a new document that asks the same reads nothing new.
  const key = request === undefined ? "" : JSON.stringify(request);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly userId: string | null;
    readonly bindings: PageBindings;
  } | null>(null);
  useEffect(() => {
    if (key === "") return;
    let current = true;
    canvasBindingsFor(JSON.parse(key) as CanvasBindingsRequest, userId).then(
      bindings => {
        if (current) setAnswer({ key, userId, bindings });
      },
      () => {
        // The sources could not be read: bound props keep their own values
        // or fallbacks, as before any answer.
      }
    );
    return () => {
      current = false;
    };
  }, [key, userId]);
  // Never another person's answer, and nothing for a page with no binding.
  if (key === "" || answer === null || answer.userId !== userId) return NONE;
  return answer.bindings;
}
