/**
 * The dashboard's pins and preferences repositories against a real database,
 * on every configured dialect: each reader's own rows, one per target or key;
 * the rows going with the reader; and, before `nextly migrate` has created the
 * tables, no pins, unset preferences and a refusal naming the command.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { DashboardPins } from "../dashboard-pins";
import { DashboardPreferences } from "../dashboard-preferences";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A new account, by email; its id. */
async function account(t: TestNextly, email: string): Promise<string> {
  const users = (
    t.nextly as unknown as {
      users: {
        create: (a: {
          data: Record<string, unknown>;
        }) => Promise<{ item: { id: string } }>;
      };
    }
  ).users;
  const created = await users.create({
    data: { email, password: "Password123!", name: email, isActive: true },
  });
  return created.item.id;
}

describe.each(getConfiguredTestDialects())(
  "the dashboard repositories (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [],
      });
      return current;
    }

    it("keeps one pin per reader per target, lists a reader's own newest first, and unpins", async () => {
      const t = await boot();
      const pins = new DashboardPins(t.adapter as never);
      const ana = await account(t, "ana@example.com");
      const rui = await account(t, "rui@example.com");
      const story = {
        targetType: "collection",
        targetSlug: "posts",
        entryId: "e1",
      } as const;
      const home = { targetType: "single", targetSlug: "home" } as const;

      await pins.pin(ana, story);
      // Pinning again keeps the one pin.
      await pins.pin(ana, story);
      await pins.pin(ana, home);
      await pins.pin(ana, home);
      await pins.pin(rui, story);

      const own = await pins.list(ana);
      expect(
        own.map(pin => [pin.targetType, pin.targetSlug, pin.entryId])
      ).toEqual([
        // Newest first: the Single was pinned after the entry.
        ["single", "home", ""],
        ["collection", "posts", "e1"],
      ]);
      expect(own.every(pin => pin.userId === ana)).toBe(true);

      expect(await pins.unpin(ana, story)).toBe(true);
      expect(await pins.unpin(ana, story)).toBe(false);
      expect((await pins.list(ana)).map(pin => pin.targetSlug)).toEqual([
        "home",
      ]);
      // Another reader's pin of the same entry is theirs, and stays.
      expect((await pins.list(rui)).map(pin => pin.entryId)).toEqual(["e1"]);

      // Deleting the target removes every reader's pin of it.
      await pins.pin(ana, story);
      expect(await pins.unpinTarget(story)).toBe(2);
      expect(await pins.list(rui)).toEqual([]);
    });

    it("keeps one value per reader per key, the latest written", async () => {
      const t = await boot();
      const preferences = new DashboardPreferences(t.adapter as never);
      const ana = await account(t, "ana@example.com");
      const rui = await account(t, "rui@example.com");

      expect(await preferences.get(ana, "new-type")).toBeUndefined();
      await preferences.set(ana, "new-type", "posts");
      await preferences.set(ana, "new-type", "pages");
      await preferences.set(rui, "new-type", "posts");
      await preferences.set(ana, "setup-collapsed", "true");

      expect(await preferences.get(ana, "new-type")).toBe("pages");
      expect(await preferences.get(rui, "new-type")).toBe("posts");
      expect(await preferences.get(ana, "setup-collapsed")).toBe("true");
      await expect(
        preferences.set(ana, "new-type", "x".repeat(256))
      ).rejects.toThrow(/at most 255 characters/);
    });

    it("deletes a reader's pins and preferences with the reader", async () => {
      const t = await boot();
      const pins = new DashboardPins(t.adapter as never);
      const preferences = new DashboardPreferences(t.adapter as never);
      // The first account of an instance is its super-admin, which may not be
      // deleted while it is the last: the readers here are ordinary accounts.
      await account(t, "admin@example.com");
      const leaving = await account(t, "leaving@example.com");
      const staying = await account(t, "staying@example.com");
      for (const id of [leaving, staying]) {
        await pins.pin(id, { targetType: "single", targetSlug: "home" });
        await preferences.set(id, "new-type", "posts");
      }

      await t.nextly.users.delete({ id: leaving });

      expect(await pins.list(leaving)).toEqual([]);
      expect(await preferences.get(leaving, "new-type")).toBeUndefined();
      // The control: the other reader's rows are untouched.
      expect(await pins.list(staying)).toHaveLength(1);
      expect(await preferences.get(staying, "new-type")).toBe("posts");
    });

    it("before `nextly migrate`, has no pins, refuses a pin naming the fix, and reads every preference as unset", async () => {
      const t = await boot();
      const ana = await account(t, "ana@example.com");
      await t.adapter.executeQuery("DROP TABLE nextly_dashboard_pins");
      await t.adapter.executeQuery("DROP TABLE nextly_dashboard_preferences");
      const warnings: string[] = [];
      const logger = { warn: (message: string) => warnings.push(message) };
      // Fresh repositories, so nothing remembers the tables from before the drop.
      const pins = new DashboardPins(t.adapter as never, logger);
      const preferences = new DashboardPreferences(t.adapter as never, logger);

      expect(await pins.list(ana)).toEqual([]);
      await expect(
        pins.pin(ana, { targetType: "single", targetSlug: "home" })
      ).rejects.toThrow(/nextly migrate/);
      expect(
        await pins.unpin(ana, { targetType: "single", targetSlug: "home" })
      ).toBe(false);

      await preferences.set(ana, "new-type", "posts");
      expect(await preferences.get(ana, "new-type")).toBeUndefined();

      // One warning per table, each naming the table and the fix.
      expect(warnings).toHaveLength(2);
      expect(warnings.join("\n")).toContain('"nextly_dashboard_pins"');
      expect(warnings.join("\n")).toContain('"nextly_dashboard_preferences"');
      expect(
        warnings.every(warning => warning.includes("nextly migrate"))
      ).toBe(true);
    });
  }
);
