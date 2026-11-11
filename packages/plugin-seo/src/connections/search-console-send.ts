/**
 * Every request the Search Console connection makes, each to one of Google's
 * fixed addresses, and the shape each answer is read in. Its own module so
 * the requests are made in one place, and so a test can stand in for Google.
 *
 * No redirect is followed: an answer that sends the request elsewhere fails
 * it. Each request is given ten seconds. An answer that is not what Google
 * documents fails it too, and the failure names the request and Google's
 * status, never a token or the body.
 *
 * @module connections/search-console-send
 */
import { z } from "nextly/zod";

import type { OutboundFetch } from "./indexnow-send";

/** Where a person signs in with Google; opened in their browser, never fetched. */
export const GOOGLE_SIGN_IN = "https://accounts.google.com/o/oauth2/v2/auth";

/** What Search Console access is asked for: reading it, and who signed in. */
export const SEARCH_CONSOLE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "openid",
  "email",
];

const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

/** The hosts these requests reach, for the plugin's outbound allowlist. */
export const SEARCH_CONSOLE_HOSTS: readonly string[] = [
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "searchconsole.googleapis.com",
];

/** How long each request is given. */
const TIMEOUT_MS = 10_000;

/** A request Google answered with something other than success. */
export class GoogleRefused extends Error {
  constructor(
    readonly request: string,
    readonly status: number
  ) {
    super(`Google answered ${request} with ${status}`);
    this.name = "GoogleRefused";
  }
}

/** The Google sign-in the site is configured with. */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** One request to Google, its answer read as `shape`. */
async function ask<T>(
  fetch: OutboundFetch,
  request: string,
  url: string,
  init: RequestInit,
  shape: z.ZodType<T>
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleRefused(request, response.status);
  }
  const read = shape.safeParse(await response.json());
  if (!read.success) throw new GoogleRefused(request, response.status);
  return read.data;
}

const form = (values: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

const bearer = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(body),
});

/** What a sign-in gave: access now, and the token that renews it. */
export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

const tokens: z.ZodType<GoogleTokens> = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
});

/** Trade the code Google sent the person back with for tokens. */
export function exchangeCode(
  fetch: OutboundFetch,
  client: GoogleClient,
  grant: { code: string; verifier: string; redirectUri: string }
): Promise<GoogleTokens> {
  return ask(
    fetch,
    "the sign-in",
    TOKEN,
    form({
      grant_type: "authorization_code",
      code: grant.code,
      code_verifier: grant.verifier,
      redirect_uri: grant.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
    tokens
  );
}

/** Access for the next requests, renewed from the kept token. */
export async function renewAccess(
  fetch: OutboundFetch,
  client: GoogleClient,
  refreshToken: string
): Promise<string> {
  const renewed = await ask(
    fetch,
    "renewing access",
    TOKEN,
    form({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
    tokens
  );
  return renewed.access_token;
}

/** Withdraw the site's access at Google, as a disconnect does. */
export async function revokeAccess(
  fetch: OutboundFetch,
  token: string
): Promise<void> {
  const response = await fetch(REVOKE, {
    ...form({ token }),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.body?.cancel();
}

const sites = z.object({
  siteEntry: z
    .array(z.object({ siteUrl: z.string(), permissionLevel: z.string() }))
    .optional(),
});

/** The Search Console properties the signed-in account can read. */
export async function listProperties(
  fetch: OutboundFetch,
  access: string
): Promise<string[]> {
  const answer = await ask(
    fetch,
    "the list of properties",
    `${WEBMASTERS}/sites`,
    { method: "GET", headers: { authorization: `Bearer ${access}` } },
    sites
  );
  return (answer.siteEntry ?? [])
    .filter(entry => entry.permissionLevel !== "siteUnverifiedUser")
    .map(entry => entry.siteUrl);
}

const analytics = z.object({
  rows: z
    .array(
      z.object({
        // Absent on a total, which is asked for by no dimension.
        keys: z.array(z.string()).optional(),
        clicks: z.number(),
        impressions: z.number(),
      })
    )
    .optional(),
});

/** A property's clicks between two days, every page counted. */
export async function totalClicks(
  fetch: OutboundFetch,
  access: string,
  property: string,
  range: { from: string; to: string }
): Promise<number> {
  const answer = await ask(
    fetch,
    "the total counts",
    `${WEBMASTERS}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    bearer(access, { startDate: range.from, endDate: range.to }),
    analytics
  );
  return answer.rows?.[0]?.clicks ?? 0;
}

/** One row of counts, by what it was counted by. */
export interface CountedRow {
  key: string;
  clicks: number;
  impressions: number;
}

/** A property's clicks and impressions between two days, by `dimension`. */
export async function countBy(
  fetch: OutboundFetch,
  access: string,
  property: string,
  query: {
    dimension: "page" | "query";
    from: string;
    to: string;
    limit: number;
  }
): Promise<CountedRow[]> {
  const answer = await ask(
    fetch,
    `the ${query.dimension} counts`,
    `${WEBMASTERS}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    bearer(access, {
      startDate: query.from,
      endDate: query.to,
      dimensions: [query.dimension],
      rowLimit: query.limit,
    }),
    analytics
  );
  return (answer.rows ?? []).map(row => ({
    key: row.keys?.[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
  }));
}

const inspection = z.object({
  inspectionResult: z
    .object({
      indexStatusResult: z
        .object({
          userCanonical: z.string().optional(),
          googleCanonical: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

/** The official address a page names, and the one Google chose. */
export async function canonicalsOf(
  fetch: OutboundFetch,
  access: string,
  property: string,
  page: string
): Promise<{ declared?: string; chosen?: string }> {
  const answer = await ask(
    fetch,
    "a page's inspection",
    INSPECT,
    bearer(access, { inspectionUrl: page, siteUrl: property }),
    inspection
  );
  const status = answer.inspectionResult?.indexStatusResult;
  return {
    ...(status?.userCanonical === undefined
      ? {}
      : { declared: status.userCanonical }),
    ...(status?.googleCanonical === undefined
      ? {}
      : { chosen: status.googleCanonical }),
  };
}
