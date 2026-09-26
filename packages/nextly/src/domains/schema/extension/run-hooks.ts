/**
 * Running schema hooks in an order that makes dependency declarations mean
 * something.
 *
 * A hook that runs before the plugin it depends on sees a schema that does not
 * yet contain the table it wants to index, so ordering is not a nicety — it
 * decides whether a correct declaration works. Plugins run in the topological
 * order the resolver already computed, then the app last, because the app is
 * the only participant entitled to see and react to everything.
 *
 * A hook that throws fails BOOT, naming its owner and its position. The
 * alternative — carrying on without it — produces a schema missing a table
 * that something is about to query.
 *
 * @module domains/schema/extension/run-hooks
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";

import {
  createOwnerDraft,
  type SchemaDraftStore,
  type SchemaHook,
} from "./draft";
import type { TableDefinition } from "./dsl";
import type { SchemaOwner } from "./types";

/** One participant's schema contribution, declarative and hook forms alike. */
export interface SchemaContribution {
  owner: SchemaOwner;
  /** Declared tables. Sugar for a hook that calls `addTable` for each. */
  tables?: readonly TableDefinition[];
  extend?: readonly SchemaHook[];
}

function describe(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? `plugin:${owner.id}` : "app";
}

/**
 * Run one contribution's declarative tables and then its hooks.
 *
 * The declarative form is applied through the SAME `addTable` a hook calls,
 * rather than being inserted into the store directly — so there is one
 * implementation of what adding a table means, and the two forms cannot
 * validate differently.
 */
async function runContribution(
  store: SchemaDraftStore,
  contribution: SchemaContribution
): Promise<void> {
  const draft = createOwnerDraft(store, contribution.owner);

  for (const table of contribution.tables ?? []) {
    draft.addTable(table);
  }

  const hooks = contribution.extend ?? [];
  for (const [position, hook] of hooks.entries()) {
    try {
      await hook({ schema: draft, dialect: store.dialect });
    } catch (cause) {
      // Rethrown with attribution: an unannotated failure from inside a hook
      // names a file in somebody else's package and nothing about whose hook
      // it was or which one in the list.
      if (cause instanceof NextlyError) throw cause;
      throw NextlyError.internal({
        cause: cause instanceof Error ? cause : undefined,
        logContext: {
          reason: "schema hook failed",
          owner: describe(contribution.owner),
          hookIndex: position,
        },
      });
    }
  }
}

/**
 * Run every contribution in order: plugins as given, then the app.
 *
 * `plugins` must already be topologically sorted — the resolver does that, and
 * re-deriving the order here would be a second implementation of a question
 * already answered.
 */
export async function runExtensionHooks(
  store: SchemaDraftStore,
  plugins: readonly SchemaContribution[],
  app?: SchemaContribution
): Promise<void> {
  for (const plugin of plugins) {
    await runContribution(store, plugin);
  }
  if (app) {
    await runContribution(store, app);
  }
}

export type { SupportedDialect };
