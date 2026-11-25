/**
 * A document's units of translation work, and accepting or dismissing a suggestion for one, for an
 * entry and for a Single alike: one reading of the request and one answer, whichever door it came
 * by.
 *
 * @module dispatcher/handlers/translation-units-handlers
 */
import { z } from "zod";

import {
  respondAction,
  respondData,
  withSessionCacheHeaders,
} from "../../api/response-shapes";
import type { TranslatedDocument } from "../../domains/i18n/pipeline/document-access";
import {
  acceptSuggestion,
  dismissSuggestion,
} from "../../domains/i18n/pipeline/suggestions";
import { unitsAnswer } from "../../domains/i18n/pipeline/unit-answer";
import { requireParam } from "../helpers/validation";
import type { Params } from "../types";

import { FieldNamed, parsed, requestCaller } from "./source-review-handlers";

/** The language a request's units are in. */
const LanguageNamed = FieldNamed.pick({ locale: true });

/** The body of a dismissal: the language the suggestion is in. */
const DismissBody = LanguageNamed.strict();

/** The body of an acceptance: the same, with the text the person changed the suggestion to. */
const AcceptBody = LanguageNamed.extend({
  value: z.unknown().optional(),
}).strict();

/** `GET …/translation-units?locale=`, of one document. */
export async function respondTranslationUnits(
  document: TranslatedDocument,
  params: Params,
  request: Request | undefined
): Promise<Response> {
  const named = parsed(LanguageNamed, { locale: params.locale });
  const answer = await unitsAnswer(document, requestCaller(request), named);
  // One caller's answer: what they may read and change decides it, so no shared cache may hand it
  // to anyone else.
  return withSessionCacheHeaders(respondData({ ...answer }));
}

/** `POST …/suggestions/{suggestionId}/accept`, of one document. */
export async function respondAcceptSuggestion(
  document: TranslatedDocument,
  params: Params,
  body: unknown,
  request: Request | undefined
): Promise<Response> {
  const suggestionId = requireParam(params, "suggestionId", "Suggestion id");
  const { locale, value } = parsed(AcceptBody, body ?? {});
  const accepted = await acceptSuggestion(document, requestCaller(request), {
    locale,
    id: suggestionId,
    // A body can carry no undefined, so only one that left the key out is
    // without a text of its own: null is a text the person cleared.
    ...(value === undefined ? {} : { value }),
  });
  return respondAction("Suggestion accepted.", {
    locale,
    suggestionId,
    ...accepted,
  });
}

/** `POST …/suggestions/{suggestionId}/dismiss`, of one document. */
export async function respondDismissSuggestion(
  document: TranslatedDocument,
  params: Params,
  body: unknown,
  request: Request | undefined
): Promise<Response> {
  const suggestionId = requireParam(params, "suggestionId", "Suggestion id");
  const { locale } = parsed(DismissBody, body ?? {});
  await dismissSuggestion(document, requestCaller(request), {
    locale,
    id: suggestionId,
  });
  return respondAction("Suggestion dismissed.", { locale, suggestionId });
}
