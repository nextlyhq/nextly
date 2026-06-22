/**
 * @public Stable string constants for the D69 document/auth/media event
 * families. Use these instead of hand-typing event names when subscribing via
 * `ctx.events.on(...)`. (Collection events are dynamic `collection.<slug>.*` and
 * are not enumerated here.) Event names + payloads are semver-protected (D40).
 */
export const DocumentEvents = {
  Published: "document.published",
  StatusChanged: "document.statusChanged",
} as const;

export const AuthEvents = {
  Registered: "auth.registered",
  LoggedIn: "auth.loggedIn",
  EmailVerified: "auth.emailVerified",
  PasswordChanged: "auth.passwordChanged",
  PasswordReset: "auth.passwordReset",
} as const;

export const MediaEvents = {
  Uploaded: "media.uploaded",
  Deleted: "media.deleted",
} as const;

export type DocumentEventName =
  (typeof DocumentEvents)[keyof typeof DocumentEvents];
export type AuthEventName = (typeof AuthEvents)[keyof typeof AuthEvents];
export type MediaEventName = (typeof MediaEvents)[keyof typeof MediaEvents];
