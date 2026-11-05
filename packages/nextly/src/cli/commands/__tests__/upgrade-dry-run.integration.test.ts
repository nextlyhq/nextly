/**
 * `nextly upgrade --dry-run` counts each step's pending work and changes
 * nothing, on every dialect: with a password an earlier release stored as
 * given, it names the step that hashes it with the count the real upgrade then
 * reports, and every table and the row stay as they were (no lock table is
 * made either). Where nobody can be asked about a backup, it names the real
 * run's refusal; given `--confirm-backed-up`, it names none.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, group, password, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { previewUpgrade, runUpgrade, type UpgradeAdapter } from "../upgrade";

type Doc = Record<string, unknown>;

const STEP = "hash passwords stored before this release";

describe.each(getConfiguredTestDialects())(
  "nextly upgrade --dry-run (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let id: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: "updry",
            fields: [
              text({ name: "title" }),
              group({ name: "box", fields: [password({ name: "pin" })] }),
            ],
          }),
        ],
      } as never);
      const { item } = await new Nextly().create({
        collection: "updry",
        data: { title: "e", box: { pin: "x" } },
      } as never);
      id = String(item.id);
      // The container as an earlier release stored it: the password as given.
      const stored = { pin: "stored-plain" };
      await t.adapter.update(
        "dc_updry",
        { box: dialect === "sqlite" ? JSON.stringify(stored) : stored },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    const adapter = () => t.adapter as unknown as UpgradeAdapter;

    /** Every table, and the seeded row. */
    async function state(): Promise<{ tables: string[]; row: Doc[] }> {
      return {
        tables: (await t.adapter.listTables()).sort(),
        row: await t.adapter.select<Doc>("dc_updry", {
          where: { and: [{ column: "id", op: "=", value: id }] },
        }),
      };
    }

    it("names each step's pending work, refuses as the real run would, and changes nothing", async () => {
      const before = await state();

      const unconfirmed = await previewUpgrade(
        {},
        { adapter: adapter(), isTTY: false }
      );
      expect(unconfirmed.refusals?.join("\n")).toMatch(/confirmed backup/);

      const plan = await previewUpgrade(
        { confirmBackedUp: true },
        { adapter: adapter(), isTTY: false }
      );
      expect(plan.refusals ?? []).toEqual([]);
      const named = plan.changes.find(change =>
        `${change.action} ${change.target}`.startsWith(`${STEP}:`)
      );
      expect(named, JSON.stringify(plan)).toBeDefined();
      expect(await state()).toEqual(before);

      // The real upgrade changes what the dry run named, by the count it named.
      const lines: string[] = [];
      await runUpgrade(
        { confirmBackedUp: true },
        {
          adapter: adapter(),
          logger: { info: line => lines.push(line), warn: () => {} },
        }
      );
      expect(lines).toContain(`${named!.action} ${named!.target}`);
      expect((await state()).row).not.toEqual(before.row);
    });
  }
);
