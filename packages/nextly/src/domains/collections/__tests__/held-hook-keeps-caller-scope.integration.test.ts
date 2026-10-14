/**
 * A hook held until an enclosing transaction commits still runs as the caller
 * whose write produced it.
 *
 * On SQLite a write made inside a plugin's `ctx.db.transaction` holds its
 * after-hooks until that transaction commits, and they then run from the
 * plugin's code rather than from the write. A scoped API key's scope, pinned
 * around the write, has to survive that wait: a hook that makes a nested
 * gated call without it is judged by the key's owner, a super-admin among
 * them, instead of the key. On PostgreSQL and MySQL the hooks run at once,
 * and the same assertions hold.
 *
 * @module domains/collections/__tests__/held-hook-keeps-caller-scope.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import {
  currentCallerScope,
  runWithCallerScope,
} from "../../../auth/caller-scope";
import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

/** A key that may only read notes: narrower than any owner. */
const KEY: AuthenticatedScope = Object.freeze({
  actorType: "apiKey",
  permissions: ["read-notes"],
});

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;
let unregister: (() => void) | undefined;

afterEach(async () => {
  unregister?.();
  unregister = undefined;
  await current?.destroy();
  current = undefined;
  ctx = undefined;
});

async function boot(
  dialect: TestDialect,
  heard: (AuthenticatedScope | undefined)[]
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/held-hooks",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(context) {
          ctx = context;
        },
      }),
    ],
    collections: [
      defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
    ],
  });
  if (!ctx) throw new Error("the plugin's init did not run");
  // Records who it runs as: what a nested gated call would be judged by.
  const hook: HookHandler = () => {
    heard.push(currentCallerScope());
  };
  registerHook("afterCreate", "notes", hook);
  unregister = () => unregisterHook("afterCreate", "notes", hook);
  return current;
}

describe.each(getConfiguredTestDialects())(
  "a hook held until commit keeps its caller (%s)",
  dialect => {
    it("runs as the key whose write produced it", async () => {
      const heard: (AuthenticatedScope | undefined)[] = [];
      const t = await boot(dialect, heard);

      await ctx!.db.transaction(async () => {
        await runWithCallerScope(KEY, () =>
          t.nextly.create({ collection: "notes", data: { title: "held" } })
        );
      });

      expect(heard).toEqual([KEY]);
    }, 120_000);

    it("runs as no key for a write made outside one", async () => {
      // The control: the hook reports the scope it was given, not a constant.
      const heard: (AuthenticatedScope | undefined)[] = [];
      const t = await boot(dialect, heard);

      await ctx!.db.transaction(async () => {
        await t.nextly.create({
          collection: "notes",
          data: { title: "plain" },
        });
      });

      expect(heard).toEqual([undefined]);
    }, 120_000);
  }
);
