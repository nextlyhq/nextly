/**
 * The field-group storage migration runs only when an operator runs `migrate:field-groups --apply`:
 * no server start, no `nextly migrate`, no `db:sync` and no request handler reaches the engine
 * that applies it.
 *
 * Read from the source's import graph (`__tests__/source-import-walk.ts`), following `import()`
 * too, since a start that loaded the engine only when it ran would still run it. The command
 * itself is the control: the same walk from it does reach the engine, so an empty answer below is
 * the graph's and not a walk that read nothing.
 *
 * The walk does not go past the CLI's command registry (`cli/program.ts`), which some commands load
 * for its shared context: it names every command, and a command's action loads only when an
 * operator runs that command.
 *
 * @module domains/field-groups/migration/__tests__/only-an-operator-runs-it.test
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chainTo, loads, SRC } from "../../../../__tests__/source-import-walk";

/** What applies the migration: the engine, and the steps it runs. */
const ENGINE = [
  "domains/field-groups/migration/run.ts",
  "domains/field-groups/migration/runner.ts",
  "domains/field-groups/migration/steps.ts",
].map(file => join(SRC, file));

/** Every path a site takes without an operator asking for this migration. */
const UNASKED = [
  // A start, in development and in production, and a configuration reload: `init.ts` is what a
  // site's `getNextly` loads, and `runtime.ts` and `next.ts` are the entries a Next.js app imports.
  "init.ts",
  "runtime.ts",
  "next.ts",
  "init/boot-apply.ts",
  "init/prod-migrations.ts",
  "init/reload-config.ts",
  "init/reload-dynamic-tables.ts",
  // Every request.
  "routeHandler.ts",
  "route-handler/index.ts",
  // `nextly migrate`, the step a deploy runs, and the commands beside it.
  "cli/commands/migrate.ts",
  "cli/commands/migrate-action.ts",
  "cli/commands/migrate-fresh.ts",
  "cli/commands/migrate-baseline.ts",
  "domains/schema/migrate/deploy-step-deps.ts",
  "cli/commands/db-sync.ts",
].map(file => join(SRC, file));

/** Walked to, never past: the registry naming every command, each loaded only when it runs. */
const REGISTRY = new Set([join(SRC, "cli/program.ts")]);

describe("the field-group storage migration", () => {
  it("is reached by no start, migrate, deploy or request path", () => {
    const reached = UNASKED.flatMap(entry => {
      const walk = loads(entry, true, REGISTRY);
      return ENGINE.filter(module => walk.from.has(module)).map(module =>
        chainTo(walk, module)
      );
    });
    expect(reached).toEqual([]);
  });

  it("is the control: the walk reaches the engine from the command that runs it", () => {
    const walk = loads(join(SRC, "cli/commands/migrate-field-groups.ts"), true);
    expect(walk.from.has(ENGINE[0]!)).toBe(true);
  });

  it("walks each path past its own file, so an empty answer is the graph's", () => {
    for (const entry of UNASKED) {
      expect(loads(entry, true, REGISTRY).from.size, entry).toBeGreaterThan(5);
    }
  });
});
