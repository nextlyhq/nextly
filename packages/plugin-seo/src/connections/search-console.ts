/**
 * Google Search Console, connected by a person who may change the SEO
 * settings: they sign in with Google, approve read-only access, and the
 * Connections tab then shows the site's clicks, what people searched, and
 * the pages where Google chose another official address than the page names.
 *
 * The sign-in uses the Google client the site's configuration names
 * (`searchConsole: { clientId, clientSecret }`), with a one-time state and a
 * PKCE verifier kept encrypted until Google sends the person back. Only
 * read-only access is asked for (`webmasters.readonly`, with `openid email`
 * to say who connected). The token that renews access is kept encrypted in
 * the plugin's settings and never leaves the server: no route answers it,
 * no log names it.
 *
 * Every request goes to one of Google's fixed addresses (`search-console-
 * send`). A failure is kept, shown on the Connections tab in plain words,
 * and changes nothing on any page.
 *
 * @module connections/search-console
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  NextlyError,
  respondDoc,
  respondMutation,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";

import { productionAddressesOf } from "../canonical";
import { siteOriginFor } from "../outputs/site-origin";
import { MANAGE_SEO_PERMISSION, siteWide } from "../permissions";
import type { ReadRules } from "../resolver/provider";
import { SETTINGS_PAGE_HREF } from "../settings/contract";

import {
  CONNECTIONS_ROUTE_PATH,
  SEARCH_CONSOLE_CALLBACK_PATH,
  SEARCH_CONSOLE_CONNECT_PATH,
  SEARCH_CONSOLE_DISCONNECT_PATH,
  SEARCH_CONSOLE_REPORT_PATH,
  type ConnectionsBody,
  type SearchConsoleConnectBody,
  type SearchConsoleReportBody,
  type SearchConsoleState,
} from "./contract";
import type { OutboundFetch } from "./indexnow-send";
import {
  canonicalsOf,
  countBy,
  exchangeCode,
  GOOGLE_SIGN_IN,
  GoogleRefused,
  listProperties,
  renewAccess,
  revokeAccess,
  totalClicks,
  SEARCH_CONSOLE_SCOPES,
  type GoogleClient,
} from "./search-console-send";
import {
  attemptNow,
  readConnections,
  writeConnections,
  type ConnectionSettings,
} from "./store";

/** How long a sign-in may take before it must be started again. */
const SIGN_IN_MS = 10 * 60 * 1000;

/** How many of the most clicked pages are checked for another address. */
const PAGES_INSPECTED = 10;

/** How many pages and searches the report lists. */
const REPORT_ROWS = 10;

/** What the connection reads with. */
export interface SearchConsoleSetup {
  /** The Google sign-in the site names, or none where it names none. */
  client?: GoogleClient;
  readRules: ReadRules;
  origin?: string;
}

/** Where the Connections tab is, for sending a person back to it. */
const CONNECTIONS_TAB = `${SETTINGS_PAGE_HREF}?tab=connections`;

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

/** Whether two secrets are the same, in time that does not tell how close. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The plugin's outbound fetch, which exists because it declared Google's hosts. */
function fetchOf(ctx: Pick<PluginContext, "fetch">): OutboundFetch {
  const { fetch } = ctx;
  if (fetch !== undefined) return (url, init) => fetch(url, init);
  throw NextlyError.serviceUnavailable({
    publicMessage: "Search Console could not be reached.",
    logMessage: "The SEO plugin was given no outbound fetch.",
  });
}

/** The sign-in the site names, or a plain refusal where it names none. */
function clientOf(setup: SearchConsoleSetup): GoogleClient {
  if (setup.client !== undefined) return setup.client;
  throw NextlyError.serviceUnavailable({
    publicMessage:
      "Search Console needs a Google sign-in for this site first. Add searchConsole to the SEO plugin's options.",
    logContext: { reason: "seo-search-console-not-configured" },
  });
}

/** The email in an ID token Google answered with, read without trusting more. */
function emailOf(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    return typeof claims === "object" &&
      claims !== null &&
      "email" in claims &&
      typeof claims.email === "string"
      ? claims.email
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The property that is the site: its address as a URL-prefix property, else
 * its domain property, else none.
 */
export function propertyFor(
  properties: readonly string[],
  origins: readonly string[]
): string | undefined {
  for (const origin of origins) {
    const prefix = `${new URL(origin).origin}/`;
    if (properties.includes(prefix)) return prefix;
  }
  // A domain property covers its subdomains: the closest one, label by label.
  for (const origin of origins) {
    const labels = new URL(origin).hostname.split(".");
    for (let at = 0; at < labels.length - 1; at++) {
      const domain = `sc-domain:${labels.slice(at).join(".")}`;
      if (properties.includes(domain)) return domain;
    }
  }
  return undefined;
}

/** The site's production addresses, the configured one where it names none. */
async function siteOrigins(
  ctx: PluginContext,
  setup: SearchConsoleSetup
): Promise<string[]> {
  const rules = await setup.readRules(ctx, undefined);
  const production = productionAddressesOf(rules.productionAddresses);
  if (production.length > 0) return production;
  const origin = await siteOriginFor(undefined, ctx, setup);
  return origin === undefined ? [] : [origin];
}

/** A failure, kept for the Connections tab, in words a person can act on. */
async function keepFailure(ctx: PluginContext, message: string): Promise<void> {
  await writeConnections(ctx, {
    searchConsoleFailed: { ...attemptNow("failed"), message },
  });
}

/** What the person is told a failure of Google's means. */
function failureMessage(error: unknown): string {
  if (error instanceof GoogleRefused) {
    if (error.status === 400 || error.status === 401) {
      return "Google no longer accepts this connection. Disconnect and connect Search Console again.";
    }
    if (error.status === 403) {
      return "This Google account can't read the site's Search Console property.";
    }
    if (error.status === 429) {
      return "Google is limiting requests for now. Try again in a few minutes.";
    }
    return `Google could not answer (${error.request}). Try again later.`;
  }
  return "Search Console could not be reached. Try again later.";
}

/** Search Console as the Connections tab shows it: never a credential. */
export function searchConsoleState(
  stored: ConnectionSettings,
  setup: SearchConsoleSetup
): SearchConsoleState {
  const connected = stored.searchConsole;
  const failed = stored.searchConsoleFailed;
  return {
    configured: setup.client !== undefined,
    ...(connected === undefined
      ? {}
      : {
          connected: {
            ...(connected.email === undefined
              ? {}
              : { email: connected.email }),
            ...(connected.property === undefined
              ? {}
              : { property: connected.property }),
          },
        }),
    ...(failed === undefined ? {} : { failed }),
  };
}

/** Begin a sign-in: where to send the person, with its state kept. */
async function connect(
  req: Request,
  ctx: PluginRouteContext,
  setup: SearchConsoleSetup
): Promise<SearchConsoleConnectBody> {
  const client = clientOf(setup);
  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  // Google sends the person back to this same route's neighbour, on the host
  // they are signed in to the admin on.
  const back = new URL(req.url);
  back.search = "";
  back.pathname = `${back.pathname.slice(
    0,
    -SEARCH_CONSOLE_CONNECT_PATH.length
  )}${SEARCH_CONSOLE_CALLBACK_PATH}`;
  const redirectUri = back.href;
  await writeConnections(ctx, {
    searchConsolePending: {
      state,
      verifier,
      redirectUri,
      expiresAt: new Date(Date.now() + SIGN_IN_MS).toISOString(),
    },
  });
  const url = new URL(GOOGLE_SIGN_IN);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SEARCH_CONSOLE_SCOPES.join(" "),
    state,
    code_challenge: base64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    // A token that renews access, asked for again on every connect.
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return { url: url.href };
}

/** Finish a sign-in Google sent the person back from. */
async function finish(
  url: URL,
  ctx: PluginRouteContext,
  setup: SearchConsoleSetup
): Promise<void> {
  const stored = await readConnections(ctx);
  const pending = stored.searchConsolePending;
  const state = url.searchParams.get("state") ?? "";
  // A callback that is not the sign-in under way, a stale one or a stray
  // one, leaves that sign-in as it is, so it can still finish.
  const matches = pending !== undefined && sameSecret(state, pending.state);
  // The sign-in it is is used once, whatever happens next.
  if (matches) await writeConnections(ctx, { searchConsolePending: null });
  if (!matches || Date.parse(pending.expiresAt) < Date.now()) {
    await keepFailure(
      ctx,
      "The Google sign-in expired or did not match. Connect Search Console again."
    );
    return;
  }
  const code = url.searchParams.get("code");
  if (code === null) {
    await keepFailure(
      ctx,
      "Google did not give access. Connect Search Console again to approve read-only access."
    );
    return;
  }
  const fetch = fetchOf(ctx);
  const client = clientOf(setup);
  try {
    const tokens = await exchangeCode(fetch, client, {
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
    });
    if (tokens.refresh_token === undefined) {
      await keepFailure(
        ctx,
        "Google did not give lasting access. Connect Search Console again."
      );
      return;
    }
    const property = propertyFor(
      await listProperties(fetch, tokens.access_token),
      await siteOrigins(ctx, setup)
    );
    const email = emailOf(tokens.id_token);
    await writeConnections(ctx, {
      searchConsole: {
        refreshToken: tokens.refresh_token,
        ...(email === undefined ? {} : { email }),
        ...(property === undefined ? {} : { property }),
      },
      searchConsoleFailed:
        property === undefined
          ? {
              ...attemptNow("failed"),
              message:
                "This Google account has no Search Console property for the site's address. Add the site in Search Console, then connect again.",
            }
          : null,
    });
  } catch (error) {
    ctx.logger.warn("Search Console could not be connected", {
      reason: error instanceof GoogleRefused ? error.message : "unreachable",
    });
    await keepFailure(ctx, failureMessage(error));
  }
}

/** The day `days` before today, as Search Console names days. */
const dayBefore = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** What Search Console says about the site over the last 28 days. */
async function report(
  ctx: PluginRouteContext,
  setup: SearchConsoleSetup
): Promise<SearchConsoleReportBody> {
  const stored = (await readConnections(ctx)).searchConsole;
  if (stored?.property === undefined) {
    throw NextlyError.notFound({
      message: "Search Console is not connected to the site's property.",
      logContext: { reason: "seo-search-console-not-connected" },
    });
  }
  const { property } = stored;
  const fetch = fetchOf(ctx);
  // Search Console's counts settle over about two days.
  const range = { from: dayBefore(30), to: dayBefore(3) };
  try {
    const access = await renewAccess(
      fetch,
      clientOf(setup),
      stored.refreshToken
    );
    const pages = await countBy(fetch, access, property, {
      ...range,
      dimension: "page",
      limit: 250,
    });
    const queries = await countBy(fetch, access, property, {
      ...range,
      dimension: "query",
      limit: REPORT_ROWS,
    });
    const inspected = pages.slice(0, PAGES_INSPECTED);
    const otherAddress: SearchConsoleReportBody["otherAddress"] = [];
    for (const row of inspected) {
      const { declared, chosen } = await canonicalsOf(
        fetch,
        access,
        property,
        row.key
      );
      if (chosen !== undefined && chosen !== (declared ?? row.key)) {
        otherAddress.push({
          page: row.key,
          chosen,
          ...(declared === undefined ? {} : { declared }),
        });
      }
    }
    await writeConnections(ctx, { searchConsoleFailed: null });
    return {
      ...range,
      // The property's own total: the pages above are only the most visited.
      clicks: await totalClicks(fetch, access, property, range),
      pages: pages.slice(0, REPORT_ROWS).map(row => ({
        page: row.key,
        clicks: row.clicks,
        impressions: row.impressions,
      })),
      queries: queries.map(row => ({
        query: row.key,
        clicks: row.clicks,
        impressions: row.impressions,
      })),
      otherAddress,
      checked: inspected.length,
    };
  } catch (error) {
    const message = failureMessage(error);
    ctx.logger.warn("Search Console could not be read", {
      reason: error instanceof GoogleRefused ? error.message : "unreachable",
    });
    await keepFailure(ctx, message);
    throw NextlyError.serviceUnavailable({
      publicMessage: message,
      logContext: { reason: "seo-search-console-read-failed" },
    });
  }
}

/** Disconnect: Google's access withdrawn where it can be, and forgotten here. */
async function disconnect(ctx: PluginRouteContext): Promise<void> {
  const stored = (await readConnections(ctx)).searchConsole;
  await writeConnections(ctx, {
    searchConsole: null,
    searchConsolePending: null,
    searchConsoleFailed: null,
  });
  if (stored === undefined || ctx.fetch === undefined) return;
  try {
    await revokeAccess(fetchOf(ctx), stored.refreshToken);
  } catch {
    // Forgotten here either way; Google expires an unused token by itself.
  }
}

/**
 * The routes the Connections tab reads and changes Search Console through:
 * site-wide SEO, each one asking `manage-seo` before it runs.
 */
export function searchConsoleRoutes(setup: SearchConsoleSetup): PluginRoute[] {
  const routes: PluginRoute[] = [
    {
      method: "GET",
      path: CONNECTIONS_ROUTE_PATH,
      handler: async (_req, ctx) => {
        const stored = await readConnections(ctx);
        const body: ConnectionsBody = {
          searchConsole: searchConsoleState(stored, setup),
          indexNow: {
            ...(stored.indexNowLast === undefined
              ? {}
              : { last: stored.indexNowLast }),
          },
        };
        return respondDoc(body);
      },
    },
    {
      method: "POST",
      path: SEARCH_CONSOLE_CONNECT_PATH,
      handler: async (req, ctx) => respondDoc(await connect(req, ctx, setup)),
    },
    {
      method: "GET",
      path: SEARCH_CONSOLE_CALLBACK_PATH,
      handler: async (req, ctx) => {
        await finish(new URL(req.url), ctx, setup);
        // Back to the Connections tab, which shows how it went.
        return new Response(null, {
          status: 303,
          headers: { location: new URL(CONNECTIONS_TAB, req.url).href },
        });
      },
    },
    {
      method: "POST",
      path: SEARCH_CONSOLE_DISCONNECT_PATH,
      handler: async (_req, ctx) => {
        await disconnect(ctx);
        return respondMutation("Search Console disconnected.", null);
      },
    },
    {
      method: "GET",
      path: SEARCH_CONSOLE_REPORT_PATH,
      handler: async (_req, ctx) => respondDoc(await report(ctx, setup)),
    },
  ];
  return routes.map(route =>
    siteWide({ ...route, requiredPermission: MANAGE_SEO_PERMISSION })
  );
}
