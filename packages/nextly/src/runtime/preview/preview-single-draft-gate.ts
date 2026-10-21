/**
 * `previewSingleDraftGate` — wire a preview token to a Single route's `draft`
 * hook.
 *
 * A sibling of `previewDraftGate` rather than a branch inside it, because the
 * two answer different questions and return different things. A collection gate
 * hands back an entry id, so the route can compare the grant against the row a
 * PATH resolved to; a Single has no path to resolve and no id — its slug is its
 * identity — so the gate settles the whole question and answers a boolean.
 *
 * Sharing one function would mean a return type that is sometimes an id and
 * sometimes a boolean, and a caller that has to know which. Two functions with
 * one comparison underneath is the honest arrangement: `previewTokenCovers`
 * remains the single place a scope is judged.
 *
 * @module runtime/preview/preview-single-draft-gate
 */
import type { UserContext } from "../../direct-api/types/shared";
import {
  singleDocumentEditable,
  singleStoredDocumentReadable,
} from "../../domains/singles/services/single-document-access";
import type { SingleDraftRequest } from "../routing/single-route";

import { openPreviewRender } from "./preview-render";
import type { PreviewScopeReaderConfig } from "./preview-route";

/** Options for {@link previewSingleDraftGate}. */
export type PreviewSingleDraftGateConfig = PreviewScopeReaderConfig;

/**
 * A `draft` hook that grants exactly the Single the request's token covers.
 *
 * Callable with no argument, like its collection counterpart: the signing
 * secret, the revocation generation and the request's cookies are facts about
 * the booted instance and the request in hand, not decisions a site makes.
 */
export function previewSingleDraftGate(
  config: PreviewSingleDraftGateConfig = {}
): (request: SingleDraftRequest) => Promise<{ readAs: UserContext } | false> {
  return async ({ slug, locale }) => {
    // The link is opened for this Single in the route's language, or not at
    // all: a link to a collection entry, or to another language, never opens
    // here.
    const render = await openPreviewRender(config, {
      kind: "single",
      single: slug,
      locale,
    });
    if (render === null) return false;
    const readAs = render.sharer;

    // Asked again, on every render, and that is what makes revocation real.
    // Rebuilding the sharer's identity re-evaluates FIELD rules and nothing
    // else: the read below runs with `overrideAccess: true`, so the Single's
    // own document rules are bypassed. A sharer who loses their update role, or
    // stops satisfying a custom rule, would otherwise keep serving the draft to
    // whoever holds the link until it expired — an account that is still
    // ACTIVE, so the deactivation check does not reach it either.
    //
    // **Both halves the mint asks, through probes that do not read.** The
    // mint asks them through `assertSinglePreviewable`, whose readable half
    // goes through `SingleQueryService.get`: that AUTO-CREATES a missing
    // Single — row, localized defaults and a first version — and runs the
    // Single's read hooks. A render is an anonymous public request, so asking
    // that way would let whoever holds a link persist a document and fire hook
    // side effects, attributed to the sharer, on a page view. Reads do not
    // write. So both are asked of the STORED row through the adapter, and the
    // Single's access gate is run against it for each operation.
    //
    // Editable, because the working-draft overlay is gated on being able to
    // EDIT the document, so edit capability decides whether a draft may be
    // handed out at all. Readable as well, because the draft is a view of the
    // document: a sharer who keeps update access and loses read access through
    // a custom rule is no longer allowed to see what the link shows.
    //
    // The sharer is asked about, never acted as: this decides whether the
    // link may serve the draft and as whom its fields are judged, and the
    // person holding the link gains nothing from it.
    const sharer = {
      user: readAs,
      // FALSE: a render is an anonymous public request. Nothing ran the
      // coarse access gate for it, and claiming otherwise skips the only part
      // that notices a withdrawn role.
      routeAuthorized: false,
      // The language the link is to, as at the mint.
      ...(render.locale === undefined ? {} : { locale: render.locale }),
    };
    if (
      !(await singleDocumentEditable(slug, sharer)) ||
      !(await singleStoredDocumentReadable(slug, sharer))
    ) {
      return false;
    }

    return { readAs };
  };
}
