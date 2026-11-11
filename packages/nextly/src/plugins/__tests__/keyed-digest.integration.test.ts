/**
 * A plugin's keyed digests against a real `nextly_meta`, on every dialect:
 * the key is stored sealed, one key serves two helpers that make it at once,
 * and a digest made before the install's secret rotates still matches once
 * the start-up has sealed the key again and the previous secret is gone.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices, registerServices } from "../../di/register";
import { MetaService } from "../../domains/meta";
import { _resetEnvCache } from "../../shared/lib/env";
import { getImageProcessor } from "../../storage/image-processor";
import { definePlugin, type PluginDefinition } from "../plugin-context";
import {
  createKeyedDigests,
  digestKeyMetaKey,
  type KeyedDigests,
} from "../security/keyed-digest";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

const NAME = "@test/keyed-digests";
const ROTATED = "nextly-test-rotated-secret-at-least-32-chars";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A plugin that hands back its `ctx.security.digests` once it starts. */
function digestingPlugin(
  onInit: (digests: KeyedDigests) => void
): PluginDefinition {
  return definePlugin({
    name: NAME,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => onInit(ctx.security.digests),
  });
}

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The real `nextly_meta` of the harness's database. */
function metaStore(): MetaService {
  return new MetaService(current!.adapter, silent as never);
}

describe.each(getConfiguredTestDialects())(
  "a plugin's keyed digests on %s",
  dialect => {
    async function boot(): Promise<KeyedDigests> {
      let digests: KeyedDigests | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [digestingPlugin(d => (digests = d))],
      });
      return digests!;
    }

    it("are stable, and keep the key sealed in nextly_meta", async () => {
      const digests = await boot();
      const one = await digests.digest("email", "ada@example.com");
      expect(await digests.digest("email", "ada@example.com")).toBe(one);

      const stored = await metaStore().get<string>(digestKeyMetaKey(NAME));
      expect(stored).toMatch(/^sealed:v2:/);
    });

    it("use one key when two helpers make it at once", async () => {
      await boot();
      const owner = "@test/racing";
      const helper = () =>
        createKeyedDigests({
          owner,
          store: () => metaStore(),
          secrets: () => [process.env.NEXTLY_SECRET ?? ""],
          probe: () => current!.adapter,
        });
      const [one, two] = await Promise.all([
        helper().digest("ip", "203.0.113.9"),
        helper().digest("ip", "203.0.113.9"),
      ]);
      expect(two).toBe(one);
    });

    it("refuse a first use inside a transaction, and work there once prepared", async () => {
      const digests = await boot();
      const adapter = current!.adapter;

      // Made inside the transaction, the key would roll back with it while this
      // process kept using it.
      await expect(
        adapter.transaction(() => digests.digest("email", "ada@example.com"))
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await metaStore().get(digestKeyMetaKey(NAME))).toBeNull();

      await digests.prepare();
      const outside = await digests.digest("email", "ada@example.com");
      await expect(
        adapter.transaction(() => digests.digest("email", "ada@example.com"))
      ).resolves.toBe(outside);
    });

    it("still match after a rotation, once the previous secret is gone", async () => {
      const digests = await boot();
      const before = await digests.digest("email", "ada@example.com");

      // Started again on the same database with the secret rotated: the start
      // seals the key again under the new secret while the old one can open it.
      const original = process.env.NEXTLY_SECRET;
      process.env.NEXTLY_SECRET_PREVIOUS = original;
      process.env.NEXTLY_SECRET = ROTATED;
      _resetEnvCache();
      try {
        clearServices();
        await registerServices({
          adapter: current!.adapter,
          imageProcessor: getImageProcessor(),
          plugins: [digestingPlugin(() => undefined)],
        });
      } finally {
        process.env.NEXTLY_SECRET = original;
        delete process.env.NEXTLY_SECRET_PREVIOUS;
        _resetEnvCache();
      }

      // Read with the rotated secret alone: the previous one is gone.
      const afterwards = createKeyedDigests({
        owner: NAME,
        store: () => metaStore(),
        secrets: () => [ROTATED],
        probe: () => current!.adapter,
      });
      expect(await afterwards.digest("email", "ada@example.com")).toBe(before);
    });
  }
);
