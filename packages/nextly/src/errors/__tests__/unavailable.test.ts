/**
 * Whether a failure means Nextly is unavailable, and the render policy that
 * follows from it.
 *
 * What each case pins:
 * - a failed start, a busy database, a service unavailable and a database
 *   that could not be reached or did not answer in time are unavailable,
 *   each as it is thrown: the adapters' own errors, core's converted ones,
 *   and either wrapped by a service as a cause;
 * - a refusal, an answer of the wrong shape or a bug is not, nor a read that
 *   found nothing to start;
 * - the render fails only for production, `next build` included, and only
 *   for an unavailable Nextly; it fails with the error itself where that
 *   already says so, and as SERVICE_UNAVAILABLE carrying it otherwise.
 */
import {
  createDatabaseError,
  poolWaitTimeoutError,
} from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DbError } from "../../database/errors";
import { markStartFailure } from "../../init/start-failure";
import { NextlyError } from "../nextly-error";
import { failRenderWhenUnavailable, isNextlyUnavailable } from "../unavailable";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** `error` as a service wraps what it caught, as a generic database error. */
const wrapped = (error: Error): NextlyError =>
  new NextlyError({
    code: "DATABASE_ERROR",
    publicMessage: "A temporary database error occurred.",
    cause: error,
  });

/** What `failRenderWhenUnavailable` threw, or undefined when it returned. */
function thrownBy(error: unknown): unknown {
  try {
    failRenderWhenUnavailable(error);
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

describe("isNextlyUnavailable", () => {
  it("is true for an error Nextly's start rejected with, whatever its shape", () => {
    const failure = new Error("getaddrinfo ENOTFOUND db.internal");
    expect(isNextlyUnavailable(failure)).toBe(false);
    markStartFailure(failure);
    expect(isNextlyUnavailable(failure)).toBe(true);
  });

  it("is false for a Next.js control-flow signal a start threw, which is never recorded as a failed start", () => {
    const signal = Object.assign(new Error("Dynamic server usage: headers"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    markStartFailure(signal);
    expect(isNextlyUnavailable(signal)).toBe(false);
  });

  it.each([
    ["DATABASE_BUSY", NextlyError.databaseBusy()],
    ["SERVICE_UNAVAILABLE", NextlyError.serviceUnavailable()],
    [
      "RULE_COULD_NOT_RUN",
      new NextlyError({
        code: "RULE_COULD_NOT_RUN",
        publicMessage: "A rule could not run.",
      }),
    ],
  ])("is true for %s", (_code, error) => {
    expect(isNextlyUnavailable(error)).toBe(true);
  });

  it.each([
    [
      "an adapter's connection error",
      createDatabaseError({ kind: "connection", message: "ECONNREFUSED" }),
    ],
    [
      "an adapter's timeout",
      createDatabaseError({ kind: "timeout", message: "statement timeout" }),
    ],
    ["an adapter's pool wait", poolWaitTimeoutError(5000)],
    [
      "core's lost connection",
      new DbError({
        message: "Connection terminated",
        kind: "connection-lost",
        dialect: "postgresql",
      }),
    ],
    [
      "core's timeout",
      new DbError({ message: "timeout", kind: "timeout", dialect: "mysql" }),
    ],
    [
      "a raw SQLite busy file",
      Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }),
    ],
    // A read that goes through Drizzle directly reaches its caller as the
    // driver threw it, under Drizzle's own query error.
    [
      "a raw PostgreSQL connection failure under Drizzle's query error",
      new Error("Failed query: select 1", {
        cause: Object.assign(new Error("connection failure"), {
          code: "08006",
          severity: "FATAL",
        }),
      }),
    ],
    [
      "a raw PostgreSQL shutdown",
      Object.assign(new Error("terminating connection"), { code: "57P01" }),
    ],
    [
      "a raw PostgreSQL statement timeout",
      Object.assign(new Error("canceling statement"), { code: "57014" }),
    ],
    [
      "a raw connection reset",
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
    ],
    [
      "a raw refused connection",
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      }),
    ],
    [
      "a raw MySQL lost connection",
      Object.assign(new Error("Connection lost"), {
        code: "PROTOCOL_CONNECTION_LOST",
      }),
    ],
  ])("is true for %s, thrown or wrapped by a service", (_name, error) => {
    expect(isNextlyUnavailable(error)).toBe(true);
    expect(isNextlyUnavailable(wrapped(error))).toBe(true);
  });

  it.each([
    ["a refusal", NextlyError.forbidden()],
    ["a missing entry", NextlyError.notFound()],
    ["a generic database error with no cause", wrapped(new Error("syntax"))],
    [
      "an adapter's constraint violation",
      createDatabaseError({ kind: "unique_violation", message: "duplicate" }),
    ],
    [
      "core's unique violation",
      new DbError({
        message: "duplicate",
        kind: "unique-violation",
        dialect: "sqlite",
      }),
    ],
    [
      "a raw PostgreSQL unique violation under Drizzle's query error",
      new Error("Failed query: insert", {
        cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
      }),
    ],
    [
      "a raw MySQL syntax error",
      Object.assign(new Error("syntax"), { code: "ER_PARSE_ERROR" }),
    ],
    ["a plugin's bug", new TypeError("cannot read properties of undefined")],
    [
      "a read that found nothing to start",
      NextlyError.configuration({ logMessage: "called before initialization" }),
    ],
    ["a thrown string", "the database is unreachable"],
    ["nothing", undefined],
  ])("is false for %s", (_name, error) => {
    expect(isNextlyUnavailable(error)).toBe(false);
  });

  it("is true for an adapter's error of another kind whose driver code says the connection was lost", () => {
    // The adapters keep the driver's code on an error they could not
    // classify, and a service may rebuild it without its cause.
    const reset = createDatabaseError({
      kind: "unknown",
      message: "read ECONNRESET",
      code: "ECONNRESET",
    });
    expect(isNextlyUnavailable(reset)).toBe(true);
    expect(isNextlyUnavailable(NextlyError.internal({ cause: reset }))).toBe(
      true
    );
  });

  it("ends on a cause chain that loops", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.assign(first, { cause: second });
    expect(isNextlyUnavailable(first)).toBe(false);
  });
});

describe("failRenderWhenUnavailable", () => {
  const busy = NextlyError.databaseBusy();
  const lost = createDatabaseError({ kind: "connection", message: "lost" });

  it("throws in production the error itself where it already says Nextly is unavailable", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(thrownBy(busy)).toBe(busy);
  });

  it("throws in production SERVICE_UNAVAILABLE carrying anything else that means it", () => {
    vi.stubEnv("NODE_ENV", "production");
    const thrown = thrownBy(wrapped(lost));
    expect(NextlyError.isCode(thrown, "SERVICE_UNAVAILABLE")).toBe(true);
    expect((thrown as Error).cause).toBeInstanceOf(NextlyError);
  });

  it("throws while `next build` prerenders, whatever NODE_ENV the build kept", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(thrownBy(busy)).toBe(busy);
  });

  it("returns in production for a failure that is not Nextly's availability", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(thrownBy(new TypeError("bug"))).toBeUndefined();
    expect(thrownBy(NextlyError.forbidden())).toBeUndefined();
  });

  it.each(["development", "test"])(
    "returns in %s, for the caller's fallback",
    nodeEnv => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("NEXT_PHASE", "phase-development-server");
      expect(thrownBy(busy)).toBeUndefined();
      expect(thrownBy(lost)).toBeUndefined();
    }
  );
});
