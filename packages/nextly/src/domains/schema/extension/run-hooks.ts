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

/** How a hook's owner is named wherever a hook is reported. */
export function describeHookOwner(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? `plugin:${owner.id}` : "app";
}

/** One hook: whose it is, and its position in that owner's `extend` list. */
export interface HookPosition {
  owner: SchemaOwner;
  position: number;
}

/**
 * The error a hook threw, with the hook's owner and position added to what
 * it already says.
 *
 * Its code, messages, public data and status are kept, so a refusal the
 * draft raised (a duplicate table, a column on a table the owner may not
 * extend) still reads as that refusal, and a caller asking what kind of error
 * it is gets the same answer. The draft names the owner in its path but not
 * the position, and an error the plugin's own code raised names neither.
 */
function attributed(error: NextlyError, hook: HookPosition): NextlyError {
  const owner = describeHookOwner(hook.owner);
  return new NextlyError({
    code: error.code,
    publicMessage: error.publicMessage,
    ...(error.publicData !== undefined ? { publicData: error.publicData } : {}),
    ...(error.messageKey !== undefined ? { messageKey: error.messageKey } : {}),
    logMessage: `Schema hook ${hook.position} of ${owner} failed: ${
      error.logMessage ?? error.publicMessage
    }`,
    logContext: { ...error.logContext, owner, hookIndex: hook.position },
    statusCode: error.statusCode,
    cause: error,
  });
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
  contribution: SchemaContribution,
  afterEach: ((hook: HookPosition) => void) | undefined
): Promise<void> {
  const draft = createOwnerDraft(store, contribution.owner);

  for (const table of contribution.tables ?? []) {
    draft.addTable(table);
  }

  const hooks = contribution.extend ?? [];
  for (const [position, hook] of hooks.entries()) {
    const at = { owner: contribution.owner, position };
    try {
      await hook({ schema: draft, dialect: store.dialect });
    } catch (cause) {
      // Rethrown with attribution: an unannotated failure from inside a hook
      // names a file in somebody else's package and nothing about whose hook
      // it was or which one in the list.
      // By its brand, not `instanceof`: a plugin bundling its own copy of
      // nextly throws errors this copy's constructor did not make.
      if (NextlyError.is(cause)) throw attributed(cause, at);
      throw NextlyError.internal({
        cause: cause instanceof Error ? cause : undefined,
        logContext: {
          reason: "schema hook failed",
          owner: describeHookOwner(contribution.owner),
          hookIndex: position,
        },
      });
    }
    afterEach?.(at);
  }
}

/**
 * Run every contribution in order: plugins as given, then the app.
 *
 * `plugins` must already be topologically sorted — the resolver does that, and
 * re-deriving the order here would be a second implementation of a question
 * already answered.
 *
 * `afterEach` is called once each hook has returned, with the hook it
 * followed, so a caller can read the store as that hook left it.
 */
export async function runExtensionHooks(
  store: SchemaDraftStore,
  plugins: readonly SchemaContribution[],
  app?: SchemaContribution,
  afterEach?: (hook: HookPosition) => void
): Promise<void> {
  for (const plugin of plugins) {
    await runContribution(store, plugin, afterEach);
  }
  if (app) {
    await runContribution(store, app, afterEach);
  }
}

export type { SupportedDialect };
