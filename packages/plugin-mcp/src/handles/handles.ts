/**
 * Handles: opaque strings a tool hands an agent when state must outlive one call, such as an
 * approval that is still pending, a page plan being built up, or an upload link.
 *
 * The door keeps no session, so a later call can only find that state through something the
 * client sends back. A handle is that something, and it is only safe to send back if it is
 * useless to anyone else: so every handle is bound to the caller it was issued to, has a stated
 * lifetime, and is refused, with an error that says which of those failed, when anyone else
 * presents it or when it has expired.
 *
 * Nothing here is a security primitive of its own. A handle is one of core's one-purpose tokens
 * (`ctx.security.secrets`): stored only as a keyed hash, derived rather than kept, expired by core
 * and spent by one write only one caller can win. This module adds the binding to the caller and
 * the refusals an agent can act on.
 *
 * ## What a handle is bound to
 *
 * The person, and the credential they arrived on: one API key is not another of the same
 * person's keys, and a key is not their signed-in session. A place is kept for the connection a
 * chat app signs in through, which is bound in as well once connections exist; until then that
 * part of the binding is empty for every caller.
 *
 * @module handles/handles
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type PluginRouteContext,
  type SecretData,
} from "@nextlyhq/plugin-sdk";

/** What a handle needs from the request's context: who is asking, and core's secrets. */
export type HandleCaller = Pick<PluginRouteContext, "user" | "caller"> & {
  security: { secrets: PluginRouteContext["security"]["secrets"] };
};

/** What a handle carries back to the tool that issued it. */
export interface HandleState<D extends SecretData> {
  /** What the issuing tool stored with it, or null when it stored nothing. */
  data: D | null;
  /** When it stops being accepted. */
  expiresAt: Date;
}

/** One kind of handle, as a tool defines it once and uses on every call. */
export interface HandleKind<D extends SecretData = SecretData> {
  /** The kind's name, as `defineHandle` was given it. */
  readonly kind: string;
  /** How long each handle of this kind is accepted, in milliseconds. */
  readonly lifetimeMs: number;
  /**
   * One fixed sentence stating the lifetime and the binding, for the description of every tool
   * that hands out or takes this kind, so an agent knows before it calls how long a handle lasts
   * and that it is no use to anyone else.
   */
  readonly lifetimeText: string;
  /** A new handle for this caller, carrying `data` (at most 1 KB serialised). */
  issue(
    caller: HandleCaller,
    data?: D
  ): Promise<{ handle: string; expiresAt: Date }>;
  /** What `handle` carries, without using it up. Refused unless this caller holds it. */
  read(caller: HandleCaller, handle: string): Promise<HandleState<D>>;
  /** What `handle` carries, using it up: a second spend is refused. */
  spend(caller: HandleCaller, handle: string): Promise<{ data: D | null }>;
}

/** A kind's name: lower-case words joined by hyphens, short enough for core's purpose names. */
const KIND = /^[a-z][a-z0-9-]{0,47}$/;

/** Core's own bounds on a token's lifetime: from one minute to 30 days. */
const LIFETIME = { lowest: 60_000, highest: 30 * 24 * 60 * 60_000 } as const;

/** Every handle's purpose starts with this, so a handle can never pass for another token. */
const PURPOSE_PREFIX = "mcp-handle.";

/** The sentence every refusal of a handle ends with: what the agent should do instead. */
const START_AGAIN = "Call the tool that issued it again to get a new one.";

/** A lifetime in words: whole days, hours or minutes, whichever is largest and exact. */
export function lifetimeInWords(ms: number): string {
  const units: [number, string][] = [
    [24 * 60 * 60_000, "day"],
    [60 * 60_000, "hour"],
    [60_000, "minute"],
  ];
  for (const [size, name] of units) {
    if (ms % size === 0) {
      const count = ms / size;
      return `${count} ${name}${count === 1 ? "" : "s"}`;
    }
  }
  // Unreachable for a lifetime `defineHandle` accepted, which is whole minutes.
  return `${ms} milliseconds`;
}

/**
 * Who `caller` is to a handle: the person, the credential and (once connections exist) the
 * connection, as one fixed-width digest. A digest rather than the ids themselves so that its
 * length never depends on how long an id is; it is no secret, since nothing in it is.
 */
function bindingOf(caller: HandleCaller): string {
  const user = caller.user;
  if (!user || !caller.caller) {
    throw NextlyError.authRequired({
      logContext: { reason: "mcp-handle-without-caller" },
    });
  }
  const credential =
    caller.caller.authMethod === "api-key"
      ? `key:${caller.caller.apiKeyId ?? ""}`
      : "session";
  // The connection's place, empty until chat-app connections exist.
  const connection = "";
  return createHash("sha256")
    .update(JSON.stringify({ person: user.id, credential, connection }), "utf8")
    .digest("hex");
}

/** The refusal for a handle this server never issued. */
function unknownHandle(kind: string): NextlyError {
  return new NextlyError({
    code: "MCP_HANDLE_UNKNOWN",
    statusCode: 404,
    publicMessage: `This handle is not one this server issued. ${START_AGAIN}`,
    logContext: { kind },
  });
}

/** The refusal for a handle past its lifetime. */
function expiredHandle(kind: string, lifetimeMs: number): NextlyError {
  return new NextlyError({
    code: "MCP_HANDLE_EXPIRED",
    statusCode: 410,
    publicMessage: `This handle has expired: it lasts ${lifetimeInWords(lifetimeMs)}. ${START_AGAIN}`,
    logContext: { kind },
  });
}

/** The refusal for a handle already used up. */
function usedHandle(kind: string): NextlyError {
  return new NextlyError({
    code: "MCP_HANDLE_USED",
    statusCode: 410,
    publicMessage: `This handle has already been used. ${START_AGAIN}`,
    logContext: { kind },
  });
}

/** The refusal for a handle presented by someone it was not issued to. */
function notYourHandle(kind: string): NextlyError {
  return new NextlyError({
    code: "MCP_HANDLE_NOT_YOURS",
    statusCode: 403,
    publicMessage:
      "This handle was issued to someone else, or to another of your credentials. Only the caller it was issued to can use it.",
    logContext: { kind },
  });
}

/**
 * Define one kind of handle: its name, and how long each one lasts.
 *
 * Throws at once for a name or a lifetime core would refuse, so a tool that defines one wrongly
 * fails when the plugin loads rather than on an agent's first call.
 */
export function defineHandle<D extends SecretData = SecretData>(
  kind: string,
  lifetimeMs: number
): HandleKind<D> {
  if (!KIND.test(kind)) {
    throw new Error(
      `@nextlyhq/plugin-mcp: a handle kind must be lower-case words joined by hyphens, at most 48 characters. Received ${JSON.stringify(kind)}.`
    );
  }
  if (
    !Number.isInteger(lifetimeMs) ||
    lifetimeMs % 60_000 !== 0 ||
    lifetimeMs < LIFETIME.lowest ||
    lifetimeMs > LIFETIME.highest
  ) {
    throw new Error(
      `@nextlyhq/plugin-mcp: a handle's lifetime must be whole minutes, from 1 minute to 30 days. Received ${String(lifetimeMs)} ms for "${kind}".`
    );
  }
  const purpose = `${PURPOSE_PREFIX}${kind}`;
  const lifetimeText = `A handle lasts ${lifetimeInWords(lifetimeMs)} and works only for you, through the credential you used to get it; after that, or for anyone else, it is refused.`;

  const read = async (
    caller: HandleCaller,
    handle: string
  ): Promise<HandleState<D>> => {
    const binding = bindingOf(caller);
    const peeked = await caller.security.secrets.peekToken({
      purpose,
      token: handle,
    });
    if (!peeked.ok) {
      if (peeked.reason === "expired") throw expiredHandle(kind, lifetimeMs);
      if (peeked.reason === "spent") throw usedHandle(kind);
      throw unknownHandle(kind);
    }
    if (peeked.subject !== binding) throw notYourHandle(kind);
    return { data: peeked.data as D | null, expiresAt: peeked.expiresAt };
  };

  return {
    kind,
    lifetimeMs,
    lifetimeText,
    async issue(caller, data) {
      const minted = await caller.security.secrets.mintToken({
        purpose,
        subject: bindingOf(caller),
        expiresInMs: lifetimeMs,
        ...(data !== undefined ? { data } : {}),
      });
      return { handle: minted.token, expiresAt: minted.expiresAt };
    },
    read,
    async spend(caller, handle) {
      // Read first, so a handle presented by the wrong caller is refused without being spent:
      // someone who got hold of another's handle must not be able to burn it.
      await read(caller, handle);
      const spent = await caller.security.secrets.consumeToken({
        purpose,
        token: handle,
      });
      if (!spent.ok) {
        if (spent.reason === "expired") throw expiredHandle(kind, lifetimeMs);
        if (spent.reason === "spent") throw usedHandle(kind);
        throw unknownHandle(kind);
      }
      return { data: spent.data as D | null };
    },
  };
}
