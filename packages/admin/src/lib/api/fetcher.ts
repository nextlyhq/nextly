import {
  deviceMemorySession,
  isRememberedSchemaPath,
  noteRememberedSchemaVersion,
  recallSchema,
  rememberSchema,
} from "../device-memory/device-memory";

import { parseApiError } from "./parseApiError";
import { authFetch } from "./refreshInterceptor";
import { takeStartupResponse } from "./startup-request";

// Schema version tracking for cross-flow notification.
// When the server bumps the schema version (e.g., code-first change),
// the admin UI detects the mismatch and dispatches an event to refetch.
declare global {
  interface Window {
    __nextlySchemaVersion?: number;
    __nextlySchemaApplying?: boolean;
    __nextlyDevReloadEs?: EventSource;
  }
}

// Dev-mode: auto-reload all open tabs when a code-first HMR schema apply
// completes. Opens one SSE connection per page load (guarded by the window
// flag so Turbopack module re-evaluations don't open duplicates).
//
// Subscribed EXPLICITLY, never at import: whether the stream exists is a
// question about the RUNNING server, and the server answers it through
// `workspace.devReload`. This module's own `NODE_ENV` was folded when the
// package was built — it says where the library was built, never where it
// runs — so an import-time check here once left production dists dialing a
// route only development serves, and consumer dev builds never dialing it
// at all.
export function enableDevReload(): void {
  if (typeof window === "undefined" || window.__nextlyDevReloadEs) return;
  const es = new EventSource(`${window.location.origin}/admin/api/dev-reload`);
  window.__nextlyDevReloadEs = es;
  es.addEventListener("schema-reload", () => window.location.reload());
}

export const BASE_URL: string =
  typeof window !== "undefined"
    ? `${window.location.origin}/admin/api`
    : "http://localhost:3000/admin/api"; // SSR fallback

/**
 * The path half of {@link BASE_URL} — where this admin's API answers, relative
 * to the origin.
 *
 * Derived from `BASE_URL` rather than written out again, because a surface
 * that NAMES an endpoint has to name the one the admin actually calls. Any
 * second spelling is a path that looks authoritative and points somewhere
 * else: the generated app mounts the handler at `/admin/api/[[...params]]`,
 * so a plausible `/api/...` is a URL nothing serves.
 */
export const API_PATH_PREFIX: string = new URL(BASE_URL).pathname;

type ApiSuccess<T> = {
  success: true;
  data: T;
  status: number;
};

type ApiErrorResult = {
  success: false;
  error: string;
  status: number;
};

export type ApiResult<T> = ApiSuccess<T> | ApiErrorResult;

/**
 * Notes the schema version a response announces, for cross-flow schema change
 * detection. If the version increased and this tab did not just apply changes
 * itself (a code-first change, or another tab), dispatches an event so the UI
 * can refetch collection data.
 *
 * Exported so a request that cannot go through {@link fetcher} -- the widget
 * batch, read as a stream rather than whole -- notes it the same way, through
 * this one check rather than a copy of it.
 */
export function noteSchemaVersion(res: Response): void {
  const schemaVersionHeader = res.headers.get("X-Nextly-Schema-Version");
  if (!schemaVersionHeader || typeof window === "undefined") return;
  const version = parseInt(schemaVersionHeader, 10);
  if (isNaN(version)) return;
  const stored = window.__nextlySchemaVersion;
  if (
    stored !== undefined &&
    version > stored &&
    !window.__nextlySchemaApplying
  ) {
    // Schema changed externally (code-first or another tab)
    window.dispatchEvent(
      new CustomEvent("nextly:schema-updated", { detail: { version } })
    );
  }
  window.__nextlySchemaVersion = version;
  // The device memory is labelled with the schema version: a move discards
  // what was kept under the old one.
  noteRememberedSchemaVersion(String(version));
}

/** Whether `init` sends a GET, the only request an earlier answer can stand for. */
function isGetRequest(init: RequestInit): boolean {
  return (init.method ?? "GET").toUpperCase() === "GET";
}

/**
 * The response to `path`: the startup request's answer where it already
 * answered this GET, once, as the response its own request would have had;
 * otherwise the server's. A schema read whose answer this device kept asks
 * whether it changed (`If-None-Match` with the kept tag), and an "unchanged"
 * (304) is answered with the kept body: the tag is a hash of the body the
 * server would send, so it is exactly that answer.
 */
async function respond(
  path: string,
  fetchOptions: RequestInit,
  isProtected: boolean
): Promise<Response> {
  const isGet = isGetRequest(fetchOptions);
  const fromStartup = isGet ? await takeStartupResponse(path) : undefined;
  if (fromStartup !== undefined) return fromStartup;
  const kept = isGet ? recallSchema(path) : undefined;
  if (kept !== undefined) {
    fetchOptions.headers = {
      ...(fetchOptions.headers as Record<string, string>),
      "If-None-Match": kept.etag,
    };
  }
  const fullUrl = `${BASE_URL}${path}`;
  const res = isProtected
    ? await authFetch(fullUrl, fetchOptions)
    : await fetch(fullUrl, fetchOptions);
  if (res.status !== 304 || kept === undefined) return res;
  // The kept body as the answer it stands for, with the server's headers (its
  // schema version and the tag among them).
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(kept.body), { status: 200, headers });
}

/**
 * Keep a schema read's answer with its tag, so the next read of it, in this
 * tab or a later one, can be answered "unchanged". Any other answer, or one
 * without a tag, is not kept, nor one to a read sent in an earlier `session`
 * of the device memory (the person signed out while it was on its way).
 */
function keepSchemaAnswer(
  path: string,
  init: RequestInit,
  res: Response,
  json: object,
  session: number
): void {
  const etag = res.headers.get("etag");
  if (etag && isGetRequest(init) && isRememberedSchemaPath(path)) {
    rememberSchema(path, etag, json, session);
  }
}

/** Distinguishes "the body could not be parsed" from a body that IS `null`. */
const PARSE_FAILED = Symbol("fetcher.parse-failed");

export async function fetcher<T = unknown>(
  path: string,
  options: RequestInit = {},
  isProtected = false
): Promise<T> {
  // Headers MERGED after the rest of the options rather than replaced by them:
  // spread last, a caller's `headers` dropped the JSON content type, so a write
  // that added one header sent its JSON body as `text/plain`.
  const fetchOptions: RequestInit = {
    method: "GET",
    credentials: isProtected ? "include" : "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  // The person this read is sent for: its answer is kept only while they are
  // still the one signed in.
  const session = deviceMemorySession();
  const res = await respond(path, fetchOptions, isProtected);

  noteSchemaVersion(res);

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw parseApiError(json, res.status);
  }

  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") || "";
  const contentLength = res.headers.get("content-length");

  if (contentLength === "0") {
    return undefined as T;
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined as T;
  }

  // A sentinel rather than `null` for the parse failure, because `null` is a
  // value the server can legitimately SEND. Catching to `null` conflated the
  // two, and the branch below then had no way to tell "the body could not be
  // read" from "the document is null".
  const json = await res.json().catch(() => PARSE_FAILED);

  if (json === PARSE_FAILED) {
    return undefined as T;
  }

  // `null` is a DOCUMENT, not an absent body — the answer a read gives when the
  // thing legitimately does not exist. `GET .../versions/autosave` returns
  // exactly that, `200 application/json` with `null`, when an author has no
  // recovery point; collapsing it to `undefined` lost the distinction and left
  // react-query throwing "Query data cannot be undefined" on every editor load,
  // for a query that had answered correctly.
  if (json === null) {
    return null as T;
  }

  // Any other non-object body — a bare string, a number — is still undefined.
  // No endpoint in this admin answers with one, so this stays as it was rather
  // than inventing a meaning for a shape nothing sends.
  if (typeof json !== "object") {
    return undefined as T;
  }

  keepSchemaAnswer(path, fetchOptions, res, json, session);

  // Server returns canonical shapes directly (no `{ data }` wrapper).
  // Callers type the generic with the canonical envelope
  // (ListResponse<T>, MutationResponse<T>, ActionResponse<R>,
  // CountResponse) or, for findByID and non-CRUD reads, the bare `T`.
  // See packages/admin/src/lib/api/response-types.ts.
  return json as T;
}
