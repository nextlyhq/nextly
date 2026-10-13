import type {
  PluginCollectionService,
  PluginCollectionTransaction,
  PluginConfig,
  PluginContext,
  PluginEmailService,
  PluginSummary,
} from "@nextlyhq/plugin-sdk";

declare const ctx: PluginContext;

/** Whether `T` (once defined) has a member named `K`. */
type Has<T, K extends PropertyKey> = K extends keyof NonNullable<T>
  ? true
  : false;

// `ctx.config` is the exported `PluginConfig`, and its plugin list holds
// summaries, not definitions: no `init` to read or replace.
const config: PluginConfig = ctx.config;
const first: PluginSummary | undefined = config.plugins?.[0];
const summaryHasInit: Has<PluginSummary, "init"> = false;

// The email settings leave the provider's credentials out.
const emailHasCredentials: Has<PluginConfig["email"], "providerConfig"> = false;

// Frozen all the way down at runtime, so readonly all the way down in the
// published types: no list under `ctx.config` offers `push`, however deep.
type Capabilities = NonNullable<PluginSummary["capabilities"]>;
const collectionsHavePush: Has<PluginConfig["collections"], "push"> = false;
const corsOriginsHavePush: Has<
  NonNullable<NonNullable<PluginConfig["security"]>["cors"]>["origin"],
  "push"
> = false;
const outboundHasPush: Has<
  NonNullable<Capabilities["net"]>["outbound"],
  "push"
> = false;

// Exported below without an annotation, so the compiler has to write its
// type into a declaration file: it can only do so if every name the type
// reaches is one a plugin can import. A field declaration's brand is not.
const users = ctx.config.users;

// The core services are facades of their plugin methods.
const email: PluginEmailService = ctx.services.email;
const emailHasAdapter: Has<PluginEmailService, "adapter"> = false;

// A collection transaction reaches the work as an opaque token.
declare const collections: PluginCollectionService;
const done: Promise<void> = collections.withTransaction(
  async (tx: PluginCollectionTransaction) => {
    await collections.createEntryInTransaction(tx, "posts", {}, {});
  }
);

// Exported so eslint does not flag the assertions as unused.
export const __configViewTypeCheck = {
  config,
  first,
  summaryHasInit,
  emailHasCredentials,
  collectionsHavePush,
  corsOriginsHavePush,
  outboundHasPush,
  users,
  email,
  emailHasAdapter,
  done,
};
