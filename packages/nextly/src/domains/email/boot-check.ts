/**
 * Tell the operator at boot when a stored email provider cannot run here.
 *
 * An optional peer dependency fails at runtime rather than at install time, so
 * without this the first evidence that a transport is missing is a failed
 * password reset in production. Boot is the earliest moment both facts are
 * known: which providers this install has stored, and which transports this
 * machine can actually load.
 *
 * @module domains/email/boot-check
 */

/**
 * Both inputs are injected rather than imported, so this stays pure logic over
 * "what is stored" and "what is loadable" and can be tested without a database
 * or a registry.
 */
export interface UnusableProviderCheckDeps {
  listProviderTypes: () => Promise<string[]>;
  isAvailable: (type: string) => boolean;
  warn: (message: string) => void;
}

export async function warnAboutUnusableProviders(
  deps: UnusableProviderCheckDeps
): Promise<void> {
  let types: string[];

  try {
    types = await deps.listProviderTypes();
  } catch {
    // A diagnostic must never be the reason a server fails to start. If the
    // provider table cannot be read yet, the send path will report the real
    // problem later with far better context than a boot warning could.
    return;
  }

  // Deduplicated: several stored rows can share one type, and the operator
  // needs to hear about the missing transport rather than about each row.
  const unusable = [...new Set(types)].filter(type => !deps.isAvailable(type));
  if (unusable.length === 0) return;

  deps.warn(
    `[nextly/email] Configured provider(s) cannot run on this install: ${unusable.join(", ")}. ` +
      `Sending through them will fail until each one's required package is installed. ` +
      `Open Settings then Email Providers in the admin to see what each needs.`
  );
}
