/**
 * The one place this package reaches for nodemailer.
 *
 * nodemailer is an optional peer dependency: it is the heaviest of the three
 * transports and the one with the most security churn, so it does not belong
 * in the hard dependency graph of installs that send over a hosted API or send
 * nothing at all.
 *
 * Both the send path and the connection probe need it, and both must fail with
 * the same actionable message, so the import lives here rather than at each
 * call site where the two could drift apart.
 *
 * @module domains/email/services/providers/nodemailer-loader
 */

import { createRequire } from "node:module";

import { NextlyError } from "../../../../errors";

/** The command reported to an install that is missing the library. */
export const NODEMAILER_INSTALL_COMMAND = "npm install nodemailer";

/**
 * The subset of nodemailer this package uses.
 *
 * Declared structurally rather than imported from `@types/nodemailer`, so
 * type-checking a consuming install does not require types for a package it
 * may deliberately not have.
 */
export interface NodemailerModule {
  createTransport: (options: unknown) => {
    sendMail: (message: unknown) => Promise<{
      messageId?: string;
      rejected?: unknown[];
    }>;
    verify: () => Promise<unknown>;
    close: () => void;
  };
}

const requireFrom = createRequire(import.meta.url);

/**
 * Whether the library can be found, without executing it.
 *
 * Resolution rather than import: this answers a synchronous question asked
 * while building the provider catalog, and deciding "is it installed" should
 * not run a third party's module initialisation as a side effect.
 */
export function isNodemailerAvailable(): boolean {
  try {
    requireFrom.resolve("nodemailer");
    return true;
  } catch {
    return false;
  }
}

/**
 * The value, if it is something that can build a transport.
 *
 * Narrows by the CALLABLE this package actually uses rather than by any name
 * or version the module reports, so whichever interop shape arrives is judged
 * on whether it can do the job.
 */
function transportFactoryOf(value: unknown): NodemailerModule | undefined {
  const candidate = value as NodemailerModule | undefined;
  return typeof candidate?.createTransport === "function"
    ? candidate
    : undefined;
}

/**
 * The one refusal this module reports, however it got there.
 *
 * Built in one place so an absent package and an unusable one give the
 * operator the same instruction: the remedy is identical, and only the log
 * context distinguishes them.
 */
function nodemailerUnavailable(cause: unknown): NextlyError {
  return new NextlyError({
    code: "NEXTLY_EMAIL_TRANSPORT_UNAVAILABLE",
    publicMessage:
      `The SMTP email provider needs the "nodemailer" package, which is not installed on this server. ` +
      `Run "${NODEMAILER_INSTALL_COMMAND}" and restart. ` +
      `Providers that send over HTTP, such as Resend and SendLayer, need no extra package.`,
    logContext: {
      reason: "nodemailer-unavailable",
      cause: cause instanceof Error ? cause.message : String(cause),
    },
  });
}

/**
 * Load nodemailer, or explain precisely what to install.
 *
 * An optional peer fails at runtime rather than at install time, so the message
 * carries the whole remedy: what is missing, the command, and the fact that
 * other providers need nothing. A bare module-not-found reaches an operator as
 * a failed password reset with no stated cause.
 */
export async function loadNodemailer(): Promise<NodemailerModule> {
  let loaded: unknown;

  try {
    loaded = await import("nodemailer");
  } catch (cause) {
    throw nodemailerUnavailable(cause);
  }

  // Published as CommonJS, so an ESM host may receive the module namespace
  // with the real export on `default`. Both shapes are handled rather than one
  // assumed, because which arrives depends on the host's bundler and not on
  // anything this package controls.
  //
  // `default` is read FIRST, and the order is load-bearing rather than
  // stylistic. A module namespace is not always a plain object: a test double
  // can be a proxy that THROWS on reading a name it was not given, so probing
  // the top level first turns a perfectly good CommonJS default into "the
  // package is missing". Reading `default` first cannot misfire, because every
  // shape that carries one carries it under that name.
  const mailer =
    transportFactoryOf((loaded as { default?: unknown })?.default) ??
    transportFactoryOf(loaded);

  // Resolved to something, but not to something that can build a transport.
  // Kept distinct from the failure above rather than thrown into it: an
  // installed-but-unusable package is a different situation from an absent
  // one, and the log context is the only place that difference survives.
  if (!mailer) {
    throw nodemailerUnavailable("nodemailer exposed no createTransport");
  }

  return mailer;
}
