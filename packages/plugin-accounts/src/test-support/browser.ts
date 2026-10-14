import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { FlowDeps } from "../flows/deps";
import { cookieName, type CookieKind } from "../http/cookies";
import { CSRF_HEADER } from "../http/guard";
import { csrf, type Endpoint } from "../http/handlers";

import { TEST_ORIGIN } from "./boot";

/** One `Set-Cookie` header: the cookie's name and value, and its attributes by lower-cased name. */
export interface SetCookie {
  name: string;
  value: string;
  attributes: ReadonlyMap<string, string>;
}

/** Reads a `Set-Cookie` header; an attribute with no value, such as `HttpOnly`, reads as "". */
export function parseSetCookie(header: string): SetCookie {
  const [pair = "", ...rest] = header.split(";");
  const index = pair.indexOf("=");
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const at = part.indexOf("=");
    const name = (at === -1 ? part : part.slice(0, at)).trim().toLowerCase();
    attributes.set(name, at === -1 ? "" : part.slice(at + 1).trim());
  }

  return {
    name: pair.slice(0, index).trim(),
    value: decodeURIComponent(pair.slice(index + 1).trim()),
    attributes,
  };
}

/** Every cookie an answer sets or clears. */
export function setCookiesOf(response: Response): SetCookie[] {
  return response.headers.getSetCookie().map(parseSetCookie);
}

/** An answer's JSON body. */
export async function json(
  response: Response
): Promise<Record<string, unknown>> {
  const body: unknown = await response.clone().json();
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Error("expected a JSON object");
  return body as Record<string, unknown>;
}

/** The refusal an endpoint threw, which fails the test when it answered instead. */
export async function refusal(answer: Promise<Response>): Promise<NextlyError> {
  try {
    await answer;
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("expected the endpoint to refuse");
}

/** Headers to change on one request: a string sets one, null leaves it out. */
export type HeaderChanges = Record<string, string | null>;

/**
 * A visitor's browser on the site, for tests that call the endpoints
 * directly: it keeps the cookies each answer sets, drops those an answer
 * clears, and sends a write as the site's own page does, from the site's
 * origin with the CSRF token it was given.
 */
export class TestBrowser {
  private readonly jar = new Map<string, string>();
  private csrfToken = "";
  /** Every answer this browser was given, in order. */
  readonly answers: Response[] = [];

  constructor(
    private readonly deps: FlowDeps,
    private readonly client = "203.0.113.9"
  ) {}

  /** Asks for the CSRF token, as the site's page does before its first write, and answers it. */
  async start(): Promise<string> {
    const body = await json(await this.get(csrf));
    if (typeof body.csrfToken !== "string")
      throw new Error("expected a CSRF token");
    this.csrfToken = body.csrfToken;
    return body.csrfToken;
  }

  /** A read, with the browser's cookies. */
  get(endpoint: Endpoint): Promise<Response> {
    return this.send(endpoint, "GET", undefined, {});
  }

  /** A write from the site's own page, with `changes` made to its headers. */
  post(
    endpoint: Endpoint,
    body: Record<string, unknown> = {},
    changes: HeaderChanges = {}
  ): Promise<Response> {
    return this.send(endpoint, "POST", JSON.stringify(body), {
      origin: TEST_ORIGIN,
      [CSRF_HEADER]: this.csrfToken,
      "content-type": "application/json",
      ...changes,
    });
  }

  /** The value of one of the plugin's cookies this browser holds, or undefined. */
  cookie(kind: CookieKind): string | undefined {
    return this.jar.get(cookieName(this.deps.settings, kind));
  }

  /** Puts a cookie in the jar, as a browser that kept an old one would send it. */
  hold(kind: CookieKind, value: string): void {
    this.jar.set(cookieName(this.deps.settings, kind), value);
  }

  private async send(
    endpoint: Endpoint,
    method: string,
    body: string | undefined,
    changes: HeaderChanges
  ): Promise<Response> {
    const headers = new Headers({ "x-forwarded-for": this.client });
    const cookies = [...this.jar]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join("; ");
    if (cookies !== "") headers.set("cookie", cookies);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
    const response = await endpoint(
      this.deps,
      new Request(`${TEST_ORIGIN}/api/plugins/accounts`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      })
    );
    this.keep(response);

    return response;
  }

  private keep(response: Response): void {
    this.answers.push(response);
    for (const cookie of setCookiesOf(response)) {
      if (cookie.attributes.get("max-age") === "0")
        this.jar.delete(cookie.name);
      else this.jar.set(cookie.name, cookie.value);
    }
  }
}
