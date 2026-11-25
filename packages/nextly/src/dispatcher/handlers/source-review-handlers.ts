/**
 * What changed in a translated field's source, and keeping its translation as it is, for an entry
 * and for a Single alike: one reading of the request and one answer, whichever door it came by.
 *
 * @module dispatcher/handlers/source-review-handlers
 */
import { z } from "zod";

import {
  respondAction,
  respondData,
  withSessionCacheHeaders,
} from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import type {
  DocumentCaller,
  TranslatedDocument,
} from "../../domains/i18n/pipeline/document-access";
import {
  keepCurrent,
  sourceChange,
} from "../../domains/i18n/pipeline/source-review";
import { readAuthenticatedScope } from "../helpers/authenticated-actor";
import { readAuthenticatedUser } from "../helpers/authenticated-user";
import type { Params } from "../types";

/** One translated field, as a request names it. */
const FieldNamed = z.object({
  locale: z.string().min(1).max(64),
  field: z.string().min(1).max(255),
});

const Fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

/** The body of a "Keep current": the field, and what the person was shown of it and its source. */
const KeepCurrentBody = FieldNamed.extend({
  valueFingerprint: Fingerprint,
  sourceFingerprint: Fingerprint,
}).strict();

/** `input` as `schema` reads it, refused as every request body is. */
function parsed<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw nextlyValidationFromZod(result.error);
  return result.data;
}

/** The request's caller, judged by every gate: a route attests none of them. */
function requestCaller(request: Request | undefined): DocumentCaller {
  return {
    user: readAuthenticatedUser(),
    authenticatedScope: readAuthenticatedScope(),
    request,
    overrideAccess: false,
  };
}

/** `GET …/source-change?locale=&field=`, of one document. */
export async function respondSourceChange(
  document: TranslatedDocument,
  params: Params,
  request: Request | undefined
): Promise<Response> {
  const named = parsed(FieldNamed, {
    locale: params.locale,
    field: params.field,
  });
  const change = await sourceChange(document, requestCaller(request), named);
  // One caller's answer: which fields they may read decides it, so no shared cache may hand it to
  // anyone else.
  return withSessionCacheHeaders(respondData({ ...change }));
}

/** `POST …/keep-current`, of one document. */
export async function respondKeepCurrent(
  document: TranslatedDocument,
  body: unknown,
  request: Request | undefined
): Promise<Response> {
  const input = parsed(KeepCurrentBody, body ?? {});
  await keepCurrent(document, requestCaller(request), input);
  return respondAction("Translation kept as it is.", {
    locale: input.locale,
    field: input.field,
  });
}
