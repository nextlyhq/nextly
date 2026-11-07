import type {
  PluginCollectionTransaction,
  PluginContext,
  PluginHookRegistry,
} from "@nextlyhq/plugin-sdk";
import { expectTypeOf } from "vitest";

// A plugin takes part in a collection's delete through `ctx.hooks`, typed from
// the SDK alone: the handlers are the one argument.
type Handlers = Parameters<PluginHookRegistry["onCollectionDelete"]>[0];
expectTypeOf<
  ReturnType<PluginHookRegistry["onCollectionDelete"]>
>().toEqualTypeOf<void>();

// Either part may be left out.
expectTypeOf<Record<never, never>>().toMatchTypeOf<Handlers>();

// The impact answers labelled items for each slug, and only reads.
expectTypeOf<NonNullable<Handlers["impact"]>>().parameters.toEqualTypeOf<
  [string]
>();
expectTypeOf<ReturnType<NonNullable<Handlers["impact"]>>>().toEqualTypeOf<
  Promise<readonly { readonly label: string; readonly kind: string }[]>
>();

// The removal is handed the slug and a transaction token, the one the
// `*InTransaction` methods take, never the adapter's transaction.
type RemovalContext = Parameters<NonNullable<Handlers["inTransaction"]>>[0];
expectTypeOf<RemovalContext>().toEqualTypeOf<{
  slug: string;
  transaction: PluginCollectionTransaction;
}>();
expectTypeOf<
  ReturnType<NonNullable<Handlers["inTransaction"]>>
>().toEqualTypeOf<Promise<void>>();

function register(ctx: PluginContext): void {
  ctx.hooks.onCollectionDelete({
    impact: async slug => [{ label: `${slug} design`, kind: "design" }],
    inTransaction: async ({ slug, transaction }) => {
      const { data } =
        await ctx.services.ownCollections.listEntriesInTransaction(
          transaction,
          "designs",
          { where: { target: { equals: slug } } },
          { lock: "update" }
        );
      for (const row of data) {
        await ctx.services.collections.deleteEntryInTransaction(
          transaction,
          "designs",
          String(row.id),
          {}
        );
      }
    },
  });
}

// Exported so lint does not flag the assertions as unused.
export const __collectionDeleteHookTypeCheck = { register };
