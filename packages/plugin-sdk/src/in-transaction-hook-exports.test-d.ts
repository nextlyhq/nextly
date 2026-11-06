import type {
  InTransactionContext,
  InTransactionHandler,
  PluginContext,
  PluginHookRegistry,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk";
import { expectTypeOf } from "vitest";

// A plugin types an in-transaction handler from the SDK alone, and holds it in
// a variable so `offInTransaction` can remove the same function later.
interface Order {
  total: number;
}

const keepLedger: InTransactionHandler<Order> = async context => {
  // The handler's database is the plugin's own, bound to the write's
  // transaction: the surface `ctx.db.transaction` hands its work, with no
  // `transaction` of its own.
  expectTypeOf(context.db).toEqualTypeOf<PluginTransaction>();
  expectTypeOf(context.db).not.toHaveProperty("transaction");
  // The document is typed by the handler's type argument, before and after.
  expectTypeOf(context.data).toEqualTypeOf<Order | undefined>();
  expectTypeOf(context.originalData).toEqualTypeOf<Order | undefined>();
  expectTypeOf(context.operation).toEqualTypeOf<
    "create" | "update" | "delete"
  >();
  expectTypeOf(context.id).toEqualTypeOf<string>();
  // A frozen copy of the shared context: readable, never written.
  expectTypeOf(context.context).toEqualTypeOf<
    Readonly<Record<string, unknown>>
  >();
  await Promise.resolve();
};

// What a handler returns is ignored, so its declared result is void.
expectTypeOf<
  ReturnType<InTransactionHandler>
>().toEqualTypeOf<void | Promise<void>>();
expectTypeOf<
  InTransactionContext<Order>["db"]
>().toEqualTypeOf<PluginTransaction>();

// Registered and removed through `ctx.hooks`, by collection slug.
expectTypeOf<PluginHookRegistry["onInTransaction"]>().toBeFunction();
expectTypeOf<PluginHookRegistry["offInTransaction"]>().toBeFunction();

function register(ctx: PluginContext): void {
  ctx.hooks.onInTransaction<Order>("orders", keepLedger);
  ctx.hooks.offInTransaction<Order>("orders", keepLedger);
}

// Exported so lint does not flag the assertions as unused.
export const __inTransactionHookExportsTypeCheck = { keepLedger, register };
