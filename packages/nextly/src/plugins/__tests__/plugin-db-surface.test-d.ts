/**
 * What a plugin's `ctx.db` lets it write, as the type a plugin compiles
 * against says it.
 *
 * Checked by `tsc -p tsconfig.tests.json`. `ctx.db` is the typed,
 * owner-checked surface: reads, writes, transactions and relational queries
 * (`ctx.db.query`) over the tables the plugin may reach, and no raw SQL.
 * `ctx.db.raw` is Drizzle's fluent builder and a transaction, with no
 * relational `query` and no `execute` or `run`. The type is the same for every
 * plugin: one the app granted raw SQL (`capabilities.db.rawSql`, listed in
 * `db.rawSqlPlugins`) is handed the live instance at runtime, and still
 * compiles against this ungranted type.
 *
 * Each absence is asserted twice. The `@ts-expect-error` lines are the
 * accesses a plugin author would write, but the directive suppresses ANY error
 * on its line, so it would stay green if the line broke for another reason.
 * The `not.toHaveProperty` assertions are evaluated by the checker and name
 * the property, so they are what separates a surface without `execute` from
 * one that only fails to compile.
 */
import { expectTypeOf } from "vitest";

import type { PluginContext } from "../plugin-context";

type PluginDb = PluginContext["db"];
type PluginRawDb = PluginDb["raw"];

declare const ctx: PluginContext;

// The positive controls. An absence assertion is also satisfied by a surface
// that lost everything, so the members each handle is meant to have are
// asserted present: the typed verbs and the owner-checked relational queries
// on `ctx.db`, and the fluent builder on `ctx.db.raw`.
expectTypeOf<PluginDb>().toHaveProperty("select");
expectTypeOf<PluginDb>().toHaveProperty("insert");
expectTypeOf<PluginDb>().toHaveProperty("transaction");
expectTypeOf<PluginDb>().toHaveProperty("query");
expectTypeOf<PluginDb>().toHaveProperty("raw");
expectTypeOf<PluginRawDb>().toHaveProperty("select");
expectTypeOf<PluginRawDb>().toHaveProperty("insert");
expectTypeOf<PluginRawDb>().toHaveProperty("transaction");

// `ctx.db` runs no raw SQL.
expectTypeOf<PluginDb>().not.toHaveProperty("execute");
expectTypeOf<PluginDb>().not.toHaveProperty("run");
// @ts-expect-error `ctx.db` has no `execute`
void ctx.db.execute;
// @ts-expect-error `ctx.db` has no `run`
void ctx.db.run;

// `ctx.db.raw` runs no raw SQL and no unchecked relational query.
expectTypeOf<PluginRawDb>().not.toHaveProperty("query");
expectTypeOf<PluginRawDb>().not.toHaveProperty("execute");
expectTypeOf<PluginRawDb>().not.toHaveProperty("run");
// @ts-expect-error `ctx.db.raw` has no relational `query`
void ctx.db.raw.query;
// @ts-expect-error `ctx.db.raw` has no `execute`
void ctx.db.raw.execute;
// @ts-expect-error `ctx.db.raw` has no `run`
void ctx.db.raw.run;
