/**
 * A caller that knows which columns were renamed answers the rename question itself
 * (`decideRenames`), and the terminal prompt is never loaded.
 *
 * A Schema Builder save runs inside the app's server, where no one is at a terminal: the Builder
 * already knows a field was renamed, from the change the person made. The generator asks the
 * caller, and applies exactly the decisions it returns — an accepted pair becomes a RENAME, a
 * declined one stays a drop and an add — on every dialect.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSqlSections } from "../../migrate/sql-sections";
import type { RenameCandidate } from "../../pipeline/pushschema-pipeline-interfaces";
import { generateMigration, type MinimalConfigEntity } from "../generate";

// The terminal prompt: a caller that decides renames itself must never reach it.
vi.mock("../prompt-renames", async importOriginal => ({
  ...(await importOriginal<typeof import("../prompt-renames")>()),
  promptRenames: vi.fn(() => {
    throw new Error("the rename prompt was loaded");
  }),
}));

const posts = (fields: MinimalConfigEntity["fields"]): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields,
});

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)("rename decisions from the caller (%s)", dialect => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-decide-renames-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  async function generate(
    step: number,
    fields: MinimalConfigEntity["fields"],
    // Every step answers for itself, the first too, so no step can reach the prompt.
    decideRenames: (
      candidates: readonly RenameCandidate[]
    ) => Promise<
      { candidate: RenameCandidate; accepted: boolean }[]
    > = async candidates =>
      candidates.map(candidate => ({ candidate, accepted: false }))
  ): Promise<string> {
    const result = await generateMigration({
      name: `step_${step}`,
      dialect,
      migrationsDir: dir,
      collections: [posts(fields)],
      singles: [],
      components: [],
      decideRenames,
      now: new Date(Date.UTC(2026, 10, 6, 12, step)),
    });
    if (result === null) throw new Error("no migration was written");
    return parseSqlSections(await readFile(result.sqlPath, "utf-8")).upSql;
  }

  it("renames the column the caller accepts and asks it about every candidate", async () => {
    await generate(1, [
      { name: "title", type: "text" },
      { name: "body", type: "text" },
    ]);
    const asked: RenameCandidate[] = [];
    const up = await generate(
      2,
      [
        { name: "title", type: "text" },
        { name: "content", type: "text" },
      ],
      async candidates => {
        asked.push(...candidates);
        return candidates.map(candidate => ({
          candidate,
          accepted:
            candidate.fromColumn === "body" && candidate.toColumn === "content",
        }));
      }
    );

    expect(
      asked.map(c => `${c.tableName}.${c.fromColumn}>${c.toColumn}`)
    ).toEqual(["dc_posts.body>content"]);
    expect(up).toMatch(
      new RegExp(`RENAME COLUMN ${q("body")} TO ${q("content")}`)
    );
    expect(up).not.toMatch(new RegExp(`DROP COLUMN ${q("body")}`));
  });

  it("keeps a drop and an add where the caller declines", async () => {
    await generate(1, [
      { name: "title", type: "text" },
      { name: "body", type: "text" },
    ]);
    const up = await generate(
      2,
      [
        { name: "title", type: "text" },
        { name: "content", type: "text" },
      ],
      async candidates =>
        candidates.map(candidate => ({ candidate, accepted: false }))
    );

    expect(up).not.toMatch(/RENAME COLUMN/);
    expect(up).toMatch(new RegExp(`DROP COLUMN ${q("body")}`));
    expect(up).toMatch(new RegExp(`${q("content")}`));
  });
});
