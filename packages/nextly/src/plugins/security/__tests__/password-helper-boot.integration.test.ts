/**
 * The password helper as a booted plugin receives it.
 *
 * Boot warns about a breached-password source it will never ask, and the
 * helper on `ctx.security.passwords` never calls an app's `passwordHasher`:
 * a plugin's people never share a hashing format with staff.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../../services/shared";
import { definePlugin, type PluginContext } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A logger whose warnings are recorded. */
function recordingLogger() {
  const warn =
    vi.fn<(message: string, meta?: Record<string, unknown>) => void>();
  const logger: Logger = { debug() {}, info() {}, warn, error() {} };
  return { logger, warn };
}

/** A plugin that hands back the context it was given. */
function capturing(): {
  plugin: ReturnType<typeof definePlugin>;
  ctx: () => PluginContext;
} {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name: "@test/password-helper",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      captured = ctx;
    },
  });
  return {
    plugin,
    ctx: () => {
      if (!captured) throw new Error("the plugin never initialised");
      return captured;
    },
  };
}

describe("booting with a breached-password source", () => {
  it("warns when the source is not https, and not when it is", async () => {
    const plain = recordingLogger();
    current = await createTestNextly({
      logger: plain.logger,
      security: {
        breachedPasswords: { source: { url: "http://ranges.example/range" } },
      },
    });
    expect(JSON.stringify(plain.warn.mock.calls)).toMatch(
      /breachedPasswords\.source\.url is not an https address/
    );
    await current.destroy();

    const secure = recordingLogger();
    current = await createTestNextly({
      logger: secure.logger,
      security: {
        breachedPasswords: { source: { url: "https://ranges.example/range" } },
      },
    });
    expect(JSON.stringify(secure.warn.mock.calls)).not.toMatch(
      /breachedPasswords/
    );
  });
});

describe("booting with a source a plugin's setup sets", () => {
  it("warns about the configuration the plugins receive, after setup", async () => {
    const { logger, warn } = recordingLogger();
    current = await createTestNextly({
      logger,
      plugins: [
        definePlugin({
          name: "@test/breached-source",
          version: "1.0.0",
          nextly: ">=0.0.0",
          setup: config => ({
            ...config,
            security: {
              ...config.security,
              breachedPasswords: {
                source: { url: "http://ranges.example/range" },
              },
            },
          }),
        }),
      ],
    });
    expect(JSON.stringify(warn.mock.calls)).toMatch(
      /breachedPasswords\.source\.url is not an https address/
    );
  });
});

describe("ctx.security.passwords", () => {
  it("never calls the app's configured passwordHasher", async () => {
    const passwordHasher = {
      reach: "unbounded" as const,
      hash: vi.fn(async () => "the app's own hash"),
      verify: vi.fn(async () => true),
    };
    const { plugin, ctx } = capturing();
    current = await createTestNextly({ plugins: [plugin], passwordHasher });

    const passwords = ctx().security.passwords;
    const hash = await passwords.hash("correct horse battery staple");
    expect(await passwords.verify("correct horse battery staple", hash)).toBe(
      true
    );
    // The app's hasher answers true to anything; the helper must not ask it.
    expect(await passwords.verify("a wrong password", hash)).toBe(false);
    expect(await passwords.verify("anything", "the app's own hash")).toBe(
      false
    );
    expect(passwordHasher.hash).not.toHaveBeenCalled();
    expect(passwordHasher.verify).not.toHaveBeenCalled();
  });
});
