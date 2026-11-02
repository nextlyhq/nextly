/**
 * A seed whose settings write fails is removed again.
 *
 * The seed is created first and recorded in the settings Single second, and
 * the two are separate writes. When the second fails, the created Layout is
 * recorded nowhere, so no later run would ever find it by id: it would sit in
 * the Layouts list for good while the next run seeds another. The property
 * that separates a correct run from that is the count of seed rows after a
 * failed run and a successful one: exactly one.
 */
import { describe, expect, it } from "vitest";

import { ensureDefaultLayout } from "./ensure-default";
import type { DefaultLayoutDirectApi } from "./store";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

interface Row {
  id: string;
  title: string;
  slug: string;
  status: string;
}

/**
 * A site with no Layouts and an empty settings Single, whose first settings
 * write fails. Creates and deletes act on `rows`, so later reads see them.
 */
function site() {
  const rows: Row[] = [];
  const deleted: string[] = [];
  let settings: Record<string, unknown> = {};
  let settingsWrites = 0;
  let created = 0;

  const matches = (row: Row, args: { where?: unknown; status?: string }) => {
    const where = args.where as
      | { id?: { in?: string[]; equals?: string } }
      | undefined;
    if (where?.id?.in !== undefined && !where.id.in.includes(row.id)) {
      return false;
    }
    if (where?.id?.equals !== undefined && where.id.equals !== row.id) {
      return false;
    }
    return args.status !== "published" || row.status === "published";
  };

  const nextly = {
    findSingle: async () => settings,
    updateSingle: async ({ data }: { data: Record<string, unknown> }) => {
      settingsWrites += 1;
      if (settingsWrites === 1) throw new Error("the settings write failed");
      settings = { ...settings, ...data };
      return { item: settings };
    },
    find: async (args: { where?: unknown; status?: string }) => ({
      items: rows.filter(row => matches(row, args)),
      meta: { hasNext: false },
    }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      created += 1;
      const row = {
        id: `seed-${String(created)}`,
        title: String(data.title),
        slug: String(data.slug),
        status: String(data.status),
      };
      rows.push(row);
      return { item: row };
    },
    delete: async ({ id }: { id: string }) => {
      deleted.push(id);
      rows.splice(
        rows.findIndex(row => row.id === id),
        1
      );
      return { item: { id } };
    },
  } as unknown as DefaultLayoutDirectApi;

  return { nextly, rows, deleted, settings: () => settings };
}

describe("a seed whose settings write fails", () => {
  it("is deleted again, and the next run leaves exactly one seed", async () => {
    const s = site();
    const warnings: string[] = [];
    const deps = {
      nextly: s.nextly,
      slugs: SLUGS,
      warn: (message: string) => warnings.push(message),
    };

    await expect(ensureDefaultLayout(deps)).rejects.toThrow(
      "the settings write failed"
    );
    expect(s.deleted).toEqual(["seed-1"]);
    expect(s.rows).toHaveLength(0);

    await expect(ensureDefaultLayout(deps)).resolves.toBe("seeded");
    expect(s.rows.map(row => row.slug)).toEqual(["default-site"]);
    expect(s.settings()).toMatchObject({
      defaultLayout: s.rows[0]?.id,
      seededLayout: s.rows[0]?.id,
    });
  });
});
