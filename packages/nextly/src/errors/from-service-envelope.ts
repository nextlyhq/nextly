/**
 * Rebuilding a `NextlyError` from the `{ success, statusCode, code, ... }`
 * envelope the services return.
 *
 * @module errors/from-service-envelope
 */

import { recordFlattenedError } from "../hooks/side-effect-warnings";

import { NEXTLY_ERROR_STATUS } from "./error-codes";
import { NextlyError } from "./nextly-error";
import { withOriginalError } from "./original-error";
import type { PublicData } from "./public-data";

/** The failure fields a service envelope can carry. */
export interface ServiceErrorEnvelope {
  statusCode?: number;
  /** Canonical `NextlyError` code, when the envelope came from one. */
  code?: string;
  /** The original `publicMessage`. */
  message?: string;
  /** Translation key for the public message, when the thrower set one. */
  messageKey?: string;
  /** The error's own public data -- what reaches the wire as `error.data`. */
  publicData?: unknown;
  /**
   * Per-field issues. Canonical `{path}` from collection results, legacy
   * `{field}` from SingleResult; both normalize here.
   */
  errors?: Array<{
    path?: string;
    field?: string;
    code?: string;
    message: string;
  }>;
}

/**
 * Build the validation error from an envelope's per-field issues.
 *
 * Per-field issues survive into the envelope so the admin can map them onto
 * form fields; the generic single-issue shape is only the fallback for
 * detail-less 400s.
 */
function validationFromEnvelope(
  envelope: ServiceErrorEnvelope,
  logContext: Record<string, unknown>,
  cause?: Error
): NextlyError {
  // The issues reach this in one of two shapes. A write path lifts them onto
  // the envelope's own `errors`, normalising the legacy `{field}` key on the
  // way; a read path carries the error's `publicData` verbatim, which is where
  // `NextlyError.validation` puts them. Reading only the first left a read
  // hook's field paths replaced by the fabricated fallback below.
  const errors =
    envelope.errors ??
    (
      envelope.publicData as
        | { errors?: ServiceErrorEnvelope["errors"] }
        | undefined
    )?.errors;
  const normalized = errors?.length
    ? errors.map(e => ({
        path: e.path ?? e.field ?? "",
        code: e.code ?? "INVALID",
        message: e.message,
      }))
    : [
        {
          path: "request",
          code: "INVALID",
          message: "The submitted data is invalid.",
        },
      ];

  // Built directly rather than through `NextlyError.validation`, which hardcodes
  // "Validation failed." and takes no message key -- so a localized validation
  // error lost both on the way through, and a client selecting its text by key
  // fell back to the default string.
  return new NextlyError({
    code: "VALIDATION_ERROR",
    // The envelope's message is only trusted when the envelope says it came
    // from a validation error. A code-less 400 reaches here from legacy
    // converters that store a raw exception's text, and promoting that to the
    // public message would put internal paths and driver detail on the wire.
    publicMessage:
      envelope.code === "VALIDATION_ERROR" && envelope.message
        ? envelope.message
        : "Validation failed.",
    statusCode: envelope.statusCode ?? NEXTLY_ERROR_STATUS.VALIDATION_ERROR,
    messageKey:
      envelope.code === "VALIDATION_ERROR" ? envelope.messageKey : undefined,
    publicData: { errors: normalized },
    logContext,
    // Forwarded like every other branch: a field-transform failure carries
    // the operator context that says which transform rejected the value.
    ...(cause !== undefined ? { cause } : {}),
  });
}

/**
 * Turn a failed service envelope back into the error that produced it.
 *
 * This is the ONLY place that knows how. Every boundary that hands a service
 * failure to a caller -- the REST dispatcher, the Direct API, the plugin-facing
 * collection facade, the bulk converter -- used to carry its own table of
 * statuses, and each table omitted different codes: a hook throwing
 * `rateLimited()` surfaced as 429 through one and as a 500 through the next.
 * One converter is what makes those answers agree.
 *
 * Reconstruction is keyed on the code, not the status, because only the code
 * identifies an error exactly: three codes share 401, two share 409, two share
 * 500, and plugins declare codes outside the canonical set entirely. The status
 * mapping below is the fallback for envelopes built by hand that carry no code.
 */
export function errorFromServiceEnvelope(
  envelope: ServiceErrorEnvelope,
  logContext: Record<string, unknown> = {},
  // The error this envelope was built from, when the caller still has it.
  // Chained rather than assigned afterwards because `cause` is read-only once
  // a NextlyError exists — and it belongs to the error's identity, not to
  // something bolted on after the fact.
  cause?: Error
): NextlyError {
  // Read from the canonical map rather than repeated literals: this converter
  // exists so one place decides how a status and a code correspond, and a
  // literal here would drift the moment that map changed.
  const status = envelope.statusCode ?? NEXTLY_ERROR_STATUS.INTERNAL_ERROR;

  if (envelope.code) {
    // Validation keeps its own path: it also normalises the legacy `{field}`
    // shape into the canonical `{path}` one the admin maps onto form fields.
    if (envelope.code === "VALIDATION_ERROR") {
      return validationFromEnvelope(envelope, logContext, cause);
    }
    return new NextlyError({
      code: envelope.code,
      // The envelope's message IS the original `publicMessage`, so this round
      // trips rather than replacing it with generic text.
      publicMessage: envelope.message ?? "The request could not be completed.",
      // Carried explicitly: a plugin code has no entry in the status enum, and
      // the envelope's status is the one the thrower chose.
      statusCode: status,
      messageKey: envelope.messageKey,
      publicData: envelope.publicData as PublicData | undefined,
      logContext,
      ...(cause !== undefined ? { cause } : {}),
    });
  }

  if (status === NEXTLY_ERROR_STATUS.NOT_FOUND) {
    return NextlyError.notFound({ logContext });
  }
  if (status === NEXTLY_ERROR_STATUS.FORBIDDEN) {
    return NextlyError.forbidden({ logContext });
  }
  if (status === NEXTLY_ERROR_STATUS.CONFLICT) {
    // Without a code, staleness is the safer default: it tells the user to
    // refresh rather than implying the write itself was invalid.
    return NextlyError.conflict({ logContext });
  }
  if (status === NEXTLY_ERROR_STATUS.VALIDATION_ERROR) {
    return validationFromEnvelope(envelope, logContext);
  }
  return NextlyError.internal({ logContext });
}

/**
 * The failure fields a service envelope should carry for a typed error.
 *
 * The inverse of {@link errorFromServiceEnvelope}, and its necessary partner: a
 * boundary can only rebuild what the envelope carried, so a catch that records
 * the status alone leaves the code-keyed rebuild nothing to key on and the
 * error reaches the caller as a generic 500 however good the converter is.
 *
 * Returns null for an untyped error, so a caller keeps whatever fallback it
 * already applies to those.
 */
export function errorEnvelopeFields(
  error: unknown
): Partial<
  Pick<
    ServiceErrorEnvelope,
    "code" | "statusCode" | "message" | "messageKey" | "publicData"
  >
> {
  // A raw driver rejection has no typed fields to lift, but it is still the
  // failure the operator needs to see — so it leaves with the provenance and
  // nothing else, rather than with nothing at all. Returning an object in both
  // cases is what stops this being an opt-in: a caller spreads the result and
  // is covered, instead of each failure branch remembering to attach the
  // original itself.
  if (!NextlyError.is(error)) {
    return error instanceof Error ? withOriginalError({}, error) : {};
  }
  // Kept for the operator before the detail is dropped. This function IS the
  // flattening for every path that uses it, so recording here covers them all
  // rather than each call site remembering to.
  recordFlattenedError(error);
  // The provenance rides on the fields themselves, so every producer that
  // spreads this gets it without remembering to. This function IS the
  // flattening for the read paths and the singles, exactly as it is the one
  // place they record the error — attaching anywhere else would mean each of
  // them opting in separately, which is how the first version of this reached
  // only the collection writes.
  return withOriginalError(
    {
      code: String(error.code),
      statusCode: error.statusCode,
      message: error.publicMessage,
      ...(error.messageKey !== undefined
        ? { messageKey: error.messageKey }
        : {}),
      ...(error.publicData !== undefined
        ? { publicData: error.publicData }
        : {}),
    },
    error
  );
}
