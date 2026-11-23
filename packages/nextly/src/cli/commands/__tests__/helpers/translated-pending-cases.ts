/**
 * The cases of a translated collection's changes not yet in a migration, registered by a test file
 * that chooses the storage layout they run on (`pending-changes-translated*.test.ts`).
 *
 * A translated collection's change can be written only in the files `migrate:create` writes beside
 * the main migration: a translated field that takes another column type changes its translations
 * table alone. `migrate:check` reports it as `migrate:create` plans it, so it fails before the
 * migration is written and passes after; a check that compared only the main tables would pass
 * on a project whose migration is still to be written.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  defineCollection,
  defineConfig,
  number,
  text,
} from "../../../../config";

import { type Loaded, pendingProject } from "./pending-project";

/** The project with `posts` translated, its `rating` the field `rating` makes. */
const project = (rating: ReturnType<typeof text> | ReturnType<typeof number>) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [text({ name: "title", localized: true }), rating],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
  });

export function translatedPendingCases(loaded: Loaded, dir: () => string) {
  const { create, check } = pendingProject(loaded, dir);
  const saidBy = (ran: { said: string[] }) => ran.said.join("\n");
  const sqlFiles = () =>
    readdirSync(join(dir(), "migrations")).filter(file =>
      file.endsWith(".sql")
    );

  it("fails the check on a translated field's new column type, as migrate:create writes it, and passes once written", async () => {
    const asText = project(text({ name: "rating", localized: true }));
    const asNumber = project(number({ name: "rating", localized: true }));
    expect((await create(asText)).code).toBeUndefined();
    expect((await check(asText)).code).toBeUndefined();
    const before = sqlFiles();

    const pending = await check(asNumber);
    expect(pending.code).toBe(1);
    expect(saidBy(pending)).toContain("translations column types dc_posts");

    // The column's values are converted, which `migrate:create` writes only with consent.
    const written = await create(asNumber, { acceptDataLoss: true });
    expect(written.code, saidBy(written)).toBeUndefined();
    // Written as a file of its own beside the main one.
    expect(sqlFiles().length).toBeGreaterThan(before.length);
    expect((await check(asNumber)).code).toBeUndefined();
  });
}
