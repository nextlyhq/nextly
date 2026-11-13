/**
 * Where the optional connections keep what they need between requests: the
 * plugin's own settings, which core stores per plugin and encrypts at every
 * path the plugin names as secret. Credentials (the IndexNow key, Search
 * Console's refresh token, a sign-in still under way) live only at those
 * paths, and the settings' read route reports a secret as set, never its
 * value, so none of them reaches the admin or any API.
 *
 * What is not a credential (who is connected, how the last attempt went) is
 * kept beside them in plain text, for the Connections tab to show, with the
 * little the Overview keeps: whether its checklist is hidden, and when old
 * SEO values were last imported.
 *
 * @module connections/store
 */
import {
  NextlyError,
  type PluginContext,
  type PluginSettingsApi,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import type { ConnectionAttempt, ConnectionResult } from "./contract";

const RESULTS = [
  "sent",
  "refused-key",
  "rate-limited",
  "no-address",
  "refused",
  "failed",
] as const satisfies readonly ConnectionResult[];

const attempt = z.object({
  at: z.string(),
  result: z.enum(RESULTS),
  urls: z.number().int().nonnegative().optional(),
});

/** The plugin's settings, as stored. */
const schema = z.object({
  /** The key search engines check IndexNow notices against. */
  indexNowKey: z.string().optional(),
  /** How IndexNow's last notice went. */
  indexNowLast: attempt.optional(),
  /** Search Console, once connected. */
  searchConsole: z
    .object({
      refreshToken: z.string(),
      email: z.string().optional(),
      property: z.string().optional(),
    })
    .optional(),
  /** A Search Console sign-in still under way, until Google sends them back. */
  searchConsolePending: z
    .object({
      state: z.string(),
      verifier: z.string(),
      redirectUri: z.string(),
      expiresAt: z.string(),
    })
    .optional(),
  /** Search Console's last attempt that failed, and what to tell the person. */
  searchConsoleFailed: attempt.extend({ message: z.string() }).optional(),
  /** The Overview's setup checklist is hidden, until someone shows it again. */
  checklistHidden: z.boolean().optional(),
  /** When an import of old SEO values was last applied, as an ISO time. */
  importedAt: z.string().optional(),
});

/** What the connections hold. */
export interface ConnectionSettings {
  indexNowKey?: string;
  indexNowLast?: ConnectionAttempt;
  searchConsole?: { refreshToken: string; email?: string; property?: string };
  searchConsolePending?: {
    state: string;
    verifier: string;
    redirectUri: string;
    expiresAt: string;
  };
  searchConsoleFailed?: ConnectionAttempt & { message: string };
  checklistHidden?: boolean;
  importedAt?: string;
}

/**
 * The plugin's settings, as it declares them to core: every connection's
 * state, its credentials sealed.
 */
export const connectionSettings: z.ZodObject<z.ZodRawShape> = schema;

/** The settings paths core keeps encrypted and never returns to the admin. */
export const CONNECTION_SECRETS: string[] = [
  "indexNowKey",
  "searchConsole.refreshToken",
  "searchConsolePending.state",
  "searchConsolePending.verifier",
];

/** The plugin's settings, which exist because it declares their shape. */
function settingsOf(ctx: Pick<PluginContext, "settings">): PluginSettingsApi {
  if (ctx.settings !== undefined) return ctx.settings;
  throw NextlyError.internal({
    logContext: { reason: "seo-plugin-settings-missing" },
  });
}

/** What the connections hold now. */
export async function readConnections(
  ctx: Pick<PluginContext, "settings">
): Promise<ConnectionSettings> {
  const stored: ConnectionSettings = schema.parse(await settingsOf(ctx).get());
  return stored;
}

/** A change to what the connections hold: `null` removes a value. */
export type ConnectionsPatch = {
  [K in keyof ConnectionSettings]?: ConnectionSettings[K] | null;
};

/** Save `patch`, leaving everything it does not name as it was. */
export async function writeConnections(
  ctx: Pick<PluginContext, "settings">,
  patch: ConnectionsPatch
): Promise<void> {
  await settingsOf(ctx).set(patch);
}

/** An attempt that just happened, as it is kept. */
export function attemptNow(
  result: ConnectionResult,
  urls?: number
): ConnectionAttempt {
  return {
    at: new Date().toISOString(),
    result,
    ...(urls === undefined ? {} : { urls }),
  };
}
