/**
 * @public Stable string constants for the D69 document/auth/media event
 * families. Use these instead of hand-typing event names when subscribing via
 * `ctx.events.on(...)`. (Collection events are dynamic `collection.<slug>.*` and
 * are not enumerated here.) Event names + payloads are semver-protected (D40).
 */
export const DocumentEvents = {
  Published: "document.published",
  StatusChanged: "document.statusChanged",
  // General "the status field changed" seam: fires on every status transition
  // (carries previousStatus/status), where Published/StatusChanged are the
  // narrower events. Enumerated so plugins can subscribe without string casts.
  StatusTransition: "document.statusTransition",
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

/**
 * @experimental Account lifecycle events core emits after the change commits. Plugins
 * subscribe to these; the per-plugin bus refuses to let one emit them.
 */
export const UserEvents = {
  Created: "user.created",
  Deleted: "user.deleted",
} as const;

/** @experimental The payload of `user.created`. */
export interface UserCreatedPayload {
  userId: string;
}

/** @experimental The payload of `user.deleted`. */
export interface UserDeletedPayload {
  userId: string;
}

/**
 * Emitted by core after a plugin's stored settings change, with
 * `{ plugin, changedKeys }`. Not part of the SDK's constant objects: plugins
 * subscribe by this name, which the generated event types include.
 */
export const PLUGIN_SETTINGS_CHANGED_EVENT = "plugin.settings.changed";

export type DocumentEventName =
  (typeof DocumentEvents)[keyof typeof DocumentEvents];
export type AuthEventName = (typeof AuthEvents)[keyof typeof AuthEvents];
export type MediaEventName = (typeof MediaEvents)[keyof typeof MediaEvents];
export type UserEventName = (typeof UserEvents)[keyof typeof UserEvents];
