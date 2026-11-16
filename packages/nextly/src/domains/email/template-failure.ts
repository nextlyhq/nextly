/**
 * Whether a send failed because of its template: the template could not be
 * rendered, or its From or Reply-To rendered to something that cannot be
 * sent. Such a failure is fixed in the template, not by the provider, so the
 * Activity offers "Fix template" for a queued email that failed this way.
 *
 * Marked on the error itself as the template send throws it, so a caller
 * that only sees the error (a queued email's attempt) can tell, without the
 * error's shape or message changing for anyone else.
 *
 * @module domains/email/template-failure
 */

const TEMPLATE_CAUSED = new WeakSet<object>();

/** `error`, marked as caused by the template, for rethrowing. */
export function templateCaused<E>(error: E): E {
  if (typeof error === "object" && error !== null) TEMPLATE_CAUSED.add(error);
  return error;
}

/** Whether `error` was marked as caused by the template. */
export function isTemplateCaused(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && TEMPLATE_CAUSED.has(error)
  );
}
