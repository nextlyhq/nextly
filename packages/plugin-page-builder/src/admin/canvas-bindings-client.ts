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
import {
  bindingDemand,
  type BindingDemand,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  bindingsFromWire,
  listCollections,
  type NamedQueryLookup,
  type PageBindings,
} from "@nextlyhq/blocks-react";
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
/**
 * The person whose answers `KEPT` holds. Always a known person: until the
 * signed-in person is known nothing is asked, so no answer is ever kept under
 * an identity two people could share.
 */
let keptFor: string | undefined;

/**
 * What the canvas asks for the page it draws, or nothing when it holds no
 * binding or has no entry to read for.
 *
 * `drawn` is every tree the canvas draws, the page's and each Layout
 * region's, prepared by the renderer's own pipeline
 * (`prepareDocumentForRead`): a component's bound nodes and its lists are in
 * them, where a stored document holds only the component's instance. The
 * published route reads for the page and its regions together, and so does
 * this.
 *
 * A component's own document has no entry of its own: a placed component
 * reads the entry of each page placing it, so its preview asks for none
 * rather than reading the component's storage row as one.
 */
export function canvasBindingsRequest(
  drawn: readonly BlockDocument[],
  identity: DocumentIdentity | null,
  locale: string | undefined,
  component = false,
  /**
   * The site's named queries: a list whose source is one whose rows are a
   * collection's entries asks for that collection's field shapes too, as
   * the published page does.
   */
  namedQueries?: NamedQueryLookup
): CanvasBindingsRequest | undefined {
  if (identity === null || drawn.length === 0) return undefined;
  const found = bindingDemand(drawn);
  const demand: BindingDemand = component
    ? {
        any: found.any,
        singles: found.singles,
        site: found.site,
        formatsDates: found.formatsDates,
      }
    : found;
  const lists = [...listCollections(drawn, namedQueries)].sort();
  const wire = demandToWire(demand);
  const asks =
    wire.entry !== undefined ||
    Object.keys(wire.singles).length > 0 ||
    wire.site ||
    wire.formatsDates ||
    lists.length > 0;
  if (!found.any || !asks) return undefined;
  return {
    source: {
      kind: identity.kind,
      slug: identity.slug,
      ...(identity.documentId === undefined ? {} : { id: identity.documentId }),
    },
    demand: wire,
    lists,
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
  userId: string,
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
 * The binding sources the canvas draws a page with, as the person editing
 * reads them. `drawn` is every tree the canvas draws, and `component` says
 * the document is a component's own (see {@link canvasBindingsRequest}).
 *
 * Until the first answer arrives, for a page with no binding, and while the
 * signed-in person is not yet known, no source is read: bound props keep
 * their own values or fallbacks, as the canvas always drew them. While a
 * changed ask is answered, the previous answer is kept, so bound values do
 * not blink to their fallbacks; when the changed ask fails, the previous
 * answer goes and the fallbacks are drawn.
 */
export function useCanvasBindings(
  drawn: readonly BlockDocument[],
  locale: string | undefined,
  component = false,
  /** The site's named queries, once the canvas has read them. */
  namedQueries?: NamedQueryLookup
): PageBindings {
  const identity = useDocumentIdentity();
  const userId = useCurrentUserId();
  const request = useMemo(
    () =>
      canvasBindingsRequest(drawn, identity, locale, component, namedQueries),
    [drawn, identity, locale, component, namedQueries]
  );
  // The ask as text: a new document that asks the same reads nothing new.
  const key = request === undefined ? "" : JSON.stringify(request);
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly userId: string;
    readonly bindings: PageBindings;
  } | null>(null);
  // Bumped once an answer has been kept its while, so the same ask is made
  // again: a source can change while what the page asks stays the same (a
  // saved title, an updated Single).
  const [round, setRound] = useState(0);
  useEffect(() => {
    // The route answers whoever the session cookie names, so an answer is
    // only asked for, and kept, under a person known by id.
    if (key === "" || userId === null) return;
    let current = true;
    let stale: ReturnType<typeof setTimeout> | undefined;
    // Asked again when the editor is back in sight, never while it is not.
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", onVisible);
      setRound(value => value + 1);
    };
    const askAgain = () => {
      if (!current) return;
      if (document.visibilityState === "hidden") {
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      setRound(value => value + 1);
    };
    canvasBindingsFor(JSON.parse(key) as CanvasBindingsRequest, userId).then(
      bindings => {
        if (!current) return;
        setAnswer({ key, userId, bindings });
        stale = setTimeout(askAgain, KEPT_FOR_MS);
      },
      () => {
        // The sources could not be read: bound props keep their own values
        // or fallbacks, as before any answer. The previous ask's answer is
        // dropped too, or the canvas would go on drawing another locale's or
        // another page's values as this one's.
        if (current) setAnswer(null);
      }
    );
    return () => {
      current = false;
      if (stale !== undefined) clearTimeout(stale);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, userId, round]);
  // Never another person's answer, none for an unknown person, and nothing
  // for a page with no binding.
  if (key === "" || answer === null || answer.userId !== userId) return NONE;
  return answer.bindings;
}
