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

/**
 * `error`, marked as caused by the template, for rethrowing. A thrown value
 * that is not an error (a template may `throw "broken"`) is wrapped in one
 * carrying it as its cause, so it can be marked and thrown as an error.
 */
export function templateCaused(error: unknown): Error {
  const marked =
    error instanceof Error ? error : new Error(String(error), { cause: error });
  TEMPLATE_CAUSED.add(marked);
  return marked;
}

/** Whether `error` was marked as caused by the template. */
export function isTemplateCaused(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && TEMPLATE_CAUSED.has(error)
  );
}
