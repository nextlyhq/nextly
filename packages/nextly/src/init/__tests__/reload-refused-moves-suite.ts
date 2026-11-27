/**
 * A field the database keeps unique, moved into a group or a repeater in a code-first config, as a
 * config reload under `next dev` refuses it: it applies nothing, and says which container could not
 * keep it and why, in the words the Schema Builder and `migrate:create` refuse it in, rather than
 * that `migrate:create` copies its values, which it would refuse too. Driven through
 * `reloadNextlyConfig` itself, on every configured dialect. Run from one file per storage layout,
 * which sets the loaded configuration's mock, as `vi.mock` is each file's own.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/target";
import {
  configOf,
  ENTITY_KINDS,
  FRAME,
  INSIDE_REPEATER_MOVES,
  HOME,
  PEOPLE,
  POSTS,
  refusalMessage,
  seed,
  TABLE_PREFIXES,
  TARGETS,
  UNIQUE_KINDS,
  type EntityKind,
  type UniqueKind,
} from "../../domains/schema/field-moves/__tests__/refused-code-moves";
import { databaseState } from "../../domains/schema/field-moves/__tests__/refused-moves-state";
import { getService } from "../../di/service-access";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

/** The configuration the reload loads, set by each step; the calling file mocks the loader. */
export function describeRefusedReloads(loaded: { config: unknown }): void {
  describe.each(getConfiguredTestDialects())(
    "a config reload refuses a field kept unique into a group or a repeater (%s)",
    (dialect: TestDialect) => {
      let handle: TestNextly | undefined;

      beforeEach(() => {
        // The reload runs its schema work only under next dev; consent to the drops a move into a
        // group would otherwise be taken as, which no move's refusal depends on.
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("NEXTLY_ACCEPT_DATA_LOSS", `dc_rcm_posts,dc_rcm_people`);
      });

      afterEach(async () => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await handle?.destroy();
        handle = undefined;
      });

      /** The app, declaring `kind`'s field on the row. */
      async function start(
        entity: EntityKind,
        kind: UniqueKind
      ): Promise<TestNextly> {
        handle = await createTestNextly({
          dialect,
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
        loaded.config = configOf(entity, kind, null);
        await reloadNextlyConfig();
        return handle;
      }

      /** What a reload under `logger` said, and that it did not throw. */
      async function reload(): Promise<string> {
        const said: string[] = [];
        const note = (line: unknown) => {
          said.push(String(line));
        };
        await reloadNextlyConfig({
          resolver: name =>
            name === "logger"
              ? { warn: note, error: note, info: () => {}, debug: () => {} }
              : getService(name as Parameters<typeof getService>[0]),
        });
        return said.join("\n");
      }

      /** Everything a refused reload leaves as it was: the tables, their rows and the registry. */
      const state = (t: TestNextly) =>
        databaseState({
          run: <T>(statement: string) =>
            (t.adapter as unknown as DrizzleAdapter).executeQuery(
              statement
            ) as unknown as Promise<T[]>,
          dialect,
          tablePrefixes: TABLE_PREFIXES,
          registries: [
            { table: "dynamic_collections", slugs: [PEOPLE, POSTS] },
            { table: "dynamic_singles", slugs: [HOME] },
            { table: MIGRATION_TARGET.registryTable, slugs: [FRAME] },
          ],
          migrations: "migrations-not-written-by-the-push",
        });

      it.each(
        ENTITY_KINDS.flatMap(entity =>
          UNIQUE_KINDS.map(kind => ({ entity, kind }))
        )
      )(
        "$entity: $kind.kind, at one depth, two and three: said why, nothing changed",
        async ({ entity, kind }) => {
          vi.spyOn(console, "warn").mockImplementation(() => {});
          vi.spyOn(console, "error").mockImplementation(() => {});
          const t = await start(entity, kind);
          await seed(t, entity, kind);
          const before = await state(t);

          for (const target of TARGETS) {
            loaded.config = configOf(entity, kind, target.path);
            const said = await reload();
            expect(said, target.what).toContain(
              refusalMessage(kind.name, target)
            );
            expect(said, target.what).toContain("The change was not applied.");
            expect(said, target.what).not.toContain(
              "Run nextly migrate:create"
            );
            expect(await state(t), target.what).toEqual(before);
          }
        }
      );

      it.each(ENTITY_KINDS)(
        "%s: a unique field already inside a repeater, moved out of it or within it: said why, nothing changed",
        async entity => {
          const kind = UNIQUE_KINDS[0];
          if (kind === undefined) throw new Error("no unique kind");
          vi.spyOn(console, "warn").mockImplementation(() => {});
          vi.spyOn(console, "error").mockImplementation(() => {});
          handle = await createTestNextly({
            dialect,
            localization: { locales: ["en", "es"], defaultLocale: "en" },
          });
          loaded.config = configOf(entity, kind, ["items"]);
          await reloadNextlyConfig();
          const t = handle;
          const before = await state(t);

          for (const { what, path, message } of INSIDE_REPEATER_MOVES) {
            loaded.config = configOf(entity, kind, path);
            const said = await reload();
            expect(said, what).toContain(message);
            expect(said, what).toContain("The change was not applied.");
            expect(await state(t), what).toEqual(before);
          }
        }
      );
    }
  );
}
