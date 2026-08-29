import type { CollectionConfig } from "../collections/config/define-collection";
import type {
  FieldStoragePrimitive,
  FieldSurface,
  FieldTypeCategory,
} from "../collections/fields/catalog";
import type { AuthorableFieldConfig } from "../collections/fields/types/plugin-field";
import type { GeneratedTypes } from "../direct-api/types/shared";
import type { RegisteredEmailProvider } from "../domains/email/provider-definition";
import type { JobDefinition } from "../domains/jobs/job-registry";
import type { FieldGroupConfig } from "../field-groups/config/types";
import type { SingleConfig } from "../singles/config/types";

import type {
  PluginAdminContributions,
  ComponentPath,
} from "./admin-contributions";
import type { PluginAuthContributions } from "./auth-contributions";
import type { PluginContext } from "./plugin-context";
import type { PluginRoute } from "./routes/route-types";

/**
 * @public A plugin-declared custom permission. CRUD permissions are
 * auto-seeded per collection/single slug separately — declare only NON-CRUD
 * custom permissions here (e.g. `{ action: 'export', resource: 'submissions' }`).
 */
export interface PluginPermission {
  action: string;
  resource: string;
  label?: string;
  description?: string;
  /**
   * A heading to file this permission under, within the plugin's own section
   * of the admin's permission matrix. Defaults to `"General"`.
   *
   * The section itself is not yours to choose — it is the package that
   * declared the permission, which the host knows and cannot be wrong about.
   * This is the level below that: a plugin with two permissions needs no
   * groups, and one with forty needs them badly, and only the plugin knows
   * which of its own verbs belong together.
   */
  group?: string;
  /**
   * Mark a permission that hands out access, destroys data irreversibly, or
   * reaches outside the site. The admin warns before granting it.
   *
   * A boolean, not a message: the warning's wording belongs to the host, so
   * that it reads the same everywhere and stays recognisable. A permission
   * that explains its own danger in its own voice is one people stop reading.
   */
  danger?: boolean;
}

/**
 * @experimental A plugin-declared role bundle — a named set of permissions
 * an admin can grant as a unit. Seeded on boot (idempotent by slug), tagged
 * `isSystem: false`, and **never auto-assigned** to users (D36 — define, don't
 * grant). Reference permissions by their `${action}-${resource}` slug.
 */
export interface PluginRole {
  /** Unique role slug (e.g. `'content-reviewer'`). `'super-admin'` is reserved. */
  slug: string;
  /** Human-readable name (e.g. `'Content Reviewer'`). */
  name: string;
  description?: string;
  /** Permission slugs this role bundles, e.g. `['read-posts', 'approve-posts']`. */
  permissionSlugs: string[];
  /** Authority level (higher = more senior); default 0. */
  level?: number;
}

/**
 * @experimental A reserved scheduled-task declaration. **Not executed yet**
 * — see `contributes.schedules`. The shape is forward-designed so it stays stable
 * once a durable-jobs backend lands.
 */
export interface ScheduledTask {
  /** Unique, namespaced task name, e.g. `'seo.regenerate-sitemap'`. */
  name: string;
  /** Cron expression or interval in milliseconds (reserved; not yet honored). */
  schedule: string | number;
  /** Task handler (reserved — the runtime does not invoke it yet). */
  handler?: (ctx: PluginContext) => Promise<void> | void;
  description?: string;
}

/**
 * @experimental A plugin-contributed email provider.
 *
 * The value produced by `defineEmailProvider(...)`, not the definition literal.
 * That indirection is what keeps a plugin's own config type usable: a
 * definition typed to its own shape is NOT assignable to one typed to
 * `Record<string, unknown>`, because `createAdapter` accepts the narrower type
 * and function parameters are checked contravariantly. Authors would have had
 * to widen every adapter to `Record<string, unknown>` and re-narrow inside,
 * which is exactly the guard the definition contract exists to remove.
 *
 * `defineEmailProvider` erases the type at the boundary instead, so the author
 * keeps full checking on the shape they wrote and core receives something it
 * can store beside every other provider.
 *
 * @example
 * ```ts
 * import { defineEmailProvider } from "@nextlyhq/plugin-sdk";
 *
 * interface PostmarkConfig { serverToken: string }
 *
 * contributes: {
 *   emailProviders: [
 *     defineEmailProvider<PostmarkConfig>({
 *       type: "postmark",
 *       label: "Postmark",
 *       configFields: [
 *         { name: "serverToken", label: "Server Token", kind: "password", required: true, secret: true },
 *       ],
 *       parseConfig: (input) => postmarkSchema.parse(input),
 *       // `config` is PostmarkConfig here, not a widened record.
 *       createAdapter: (config) => createPostmarkAdapter(config),
 *     }),
 *   ],
 * }
 * ```
 */
export type PluginEmailProvider = RegisteredEmailProvider;

/**
 * @experimental A plugin-contributed email template, seeded into the
 * `email_templates` table on boot (idempotent by slug; never clobbers admin
 * edits). Resolvable by slug via `sendWithTemplate` and the direct API.
 */
export interface PluginEmailTemplate {
  slug: string;
  name: string;
  /** Subject line; supports `{{variable}}` interpolation. */
  subject: string;
  /** HTML body; supports `{{variable}}` interpolation. */
  htmlContent: string;
  plainTextContent?: string;
  variables?: Array<{ name: string; description?: string; required?: boolean }>;
  /** Wrap with the shared layout; default true. */
  useLayout?: boolean;
}

/**
 * @experimental A plugin-contributed custom field type (C7/D16, M9a minimal
 * seam). The type persists as an existing `storage` primitive and renders via
 * the given admin `component`. Values are checked against that primitive's
 * built-in rules, then the type's own `validate`, then the field's standard
 * `validate` option. (Typed builders + Visual-Builder UI are full-M9.)
 */
// Re-exported from the field catalog (its canonical home, beside the built-in
// surface types) so plugin authors keep importing it from the plugin surface.
export type { FieldSurface };

export interface PluginFieldType {
  /** Field type id used as `field.type` (e.g. `"rating"`). Must not collide with a built-in. */
  type: string;
  /** The existing storage primitive this type persists as. */
  storage: FieldStoragePrimitive;
  /** Admin field-editor component path, resolved via the component registry. */
  component: ComponentPath;
  /**
   * Human label shown in field-type pickers. Defaults to a title-cased `type`
   * (e.g. `"rating"` → `"Rating"`).
   */
  label?: string;
  /** One-line hint shown under the label in pickers. */
  description?: string;
  /**
   * Lucide icon name shown on the picker card, resolved by the admin's icon
   * set. Falls back to a generic icon when the name does not resolve.
   */
  icon?: string;
  /** Picker grouping. Defaults to `"Advanced"`. */
  category?: FieldTypeCategory;
  /**
   * Which admin surfaces may offer this type in their field pickers. Omitted
   * means the entry/single editing surface only — a type never auto-appears
   * on a surface its author did not opt into. Instances of a type that later
   * stops being offered still render (read-only degradation), they are never
   * dropped.
   */
  surfaces?: readonly FieldSurface[];
  /**
   * Layout hint for the entry/single form. `"takeover"`: when a visible field of
   * this type is present, the form body shows only that field plus the field that
   * controls its `admin.condition` (e.g. an editor-mode switch), hiding the rest.
   * Generic — any plugin field type may opt in.
   */
  layout?: "takeover";
  /**
   * Server-side validation for values stored in this field type.
   *
   * Without this a custom type is only ever checked as its `storage`
   * primitive — for `json` that means "is it JSON" and nothing more — so a
   * type could state no rule about what it accepts. Declared here rather than
   * per field because a type's rules are properties of the type: every
   * instance gets them, instead of each schema author remembering to repeat a
   * `validate` function.
   *
   * Runs after the built-in rules for the storage primitive and BEFORE the
   * field's own `validate`, so a schema author's rule composes on top of this
   * one rather than replacing it. An absent or empty value never reaches here
   * — that is what `required` is for — and neither does one the storage
   * primitive already refused, so a validator never has to re-check that it
   * was handed the shape its type stores.
   *
   * Return `true` to accept. Return a string for a single problem, or an array
   * when one value can be wrong in several places at once (a structured
   * document, a list of rows); each issue may carry its own `path` so the
   * writer is told where. Anything else is treated as a refusal, as is
   * throwing, so a validator that forgets to return fails loudly rather than
   * silently accepting everything.
   *
   * Runs on the entry, single, and component write paths. A type offered on
   * the `users`, `forms`, or `blocks` surface does NOT run it yet: those
   * surfaces validate through their own paths, which do not consult this
   * registry.
   */
  validate?: (
    value: unknown,
    args: PluginFieldValidateArgs
  ) => PluginFieldValidationResult | Promise<PluginFieldValidationResult>;
  /**
   * Checks on the field's own DECLARATION, run when a schema is registered
   * rather than when a value is written.
   *
   * `validate` answers "is this value allowed in this field". This answers "is
   * this field declared coherently at all" — a policy option that is not the
   * shape the type reads, or one whose settings contradict each other so no
   * value could ever satisfy them. Those are defects in the schema, and a
   * schema defect that surfaces per write is reported to the wrong person: the
   * writer cannot fix it, and it fails every write until whoever declared the
   * field notices.
   *
   * Runs on every path a declaration reaches storage by: boot, `db:sync` and
   * its watcher, a Schema Builder write, `nextly build`, `migrate:create`, and
   * an HMR reload. Each sits after the field-type registry is populated,
   * because the config bundle is evaluated before `contributes.fieldTypes` is
   * registered — so the `define*` calls, where a code-first config is otherwise
   * validated, reject a custom type as unknown before any option check of it
   * could run.
   *
   * Checks the declaration as WRITTEN. On the Builder path that means the
   * submitted payload rather than the parsed copy, because the manifest schema
   * drops keys it does not declare while the write persists the original — so
   * the options a type reads are present in what is stored and absent from what
   * was parsed.
   *
   * Runs for fields on collections, singles and components, including nested
   * ones. A type offered only on the `users`, `forms`, or `blocks` surface does
   * NOT get its declarations checked: those surfaces have their own config
   * validators, which do not consult this registry.
   *
   * Synchronous on purpose: a declaration is checked against itself, and a
   * config-time rule that needed I/O would make startup depend on something
   * that can be down.
   *
   * Return `true` to accept, a string for one problem, or an array to point at
   * individual options — a path is appended to the field's own, so `"allow"`
   * reports against `fields[2].allow`. A `code` is not carried: these are
   * reported through error-code unions that are closed and public, so the
   * canonical member is used and the message carries the detail. Throwing is
   * treated as a refusal.
   *
   * Options are read from the field itself and from its `pluginOptions`
   * container, merged into one flat view with the container winning, so where
   * an option was stored is not something this has to know. Directly on the
   * field is legal only while the name differs from every key the field schema
   * declares (`options`, `fields`, `admin`, `label`, and the rest of the
   * built-in field surface): the manifest applies that shape to every field
   * regardless of type, so a colliding name is judged against the core meaning
   * and refused before this runs. The container is where such a name can mean
   * something else, because core never looks inside it — except for `type` and
   * `name`, which the instance restates as its own identity and so cannot carry
   * an option; a manifest write using either inside the container is refused.
   *
   * Paths here are RELATIVE, where `validate`'s are absolute. The difference is
   * deliberate: a value validator may address a position deep inside a stored
   * document and is told where the field sits so it can build that, while this
   * one only ever names an option it already knows by name and has no way to
   * learn its own index.
   */
  validateOptions?: (field: PluginFieldInstance) => PluginFieldValidationResult;

  /**
   * What `nextly build` emits for a field of this type.
   *
   * Without it a custom type is generated as its storage primitive's default —
   * `string` for the TypeScript types, an unconstrained value for the Zod
   * schemas — because the generators know the built-in types and nothing else.
   * That is the difference between a type an app can consume and one it has to
   * cast at every use, and it is the reason a structured type is worth
   * contributing rather than storing as opaque JSON.
   *
   * Both callbacks receive the field as DECLARED, so a type whose options
   * narrow what it stores can narrow what it generates: a field restricted to
   * two kinds can emit a union of those two rather than the whole set.
   *
   * The strings are written verbatim into the generated file, which is source
   * the app compiles. A malformed expression breaks that app's build rather
   * than anything here, so a type is expected to emit something it has checked;
   * the generators do not parse it. Keep the output deterministic — the file is
   * committed, and a value that varies between runs shows up as a spurious
   * diff.
   */
  codegen?: PluginFieldCodegen;

  /**
   * What a field of this type holds when nothing has been written to it.
   *
   * Two paths need it and must agree: backfilling a NOT NULL column added to a
   * table that already has rows, and seeding a required field on a record
   * created without one — a single auto-created on first read. Core derives
   * both from the storage primitive (`{}` for `json`, `0` for `number`), which
   * is right for a type that stores a bag and wrong for one that stores a
   * structured document: `{}` satisfies the column and then fails every read
   * that expects the structure.
   *
   * Returns the VALUE, never SQL and never a pre-serialized string. A
   * `boolean`-backed type returning `"false"` would seed a truthy string into
   * a boolean column, so the type states what it holds and each caller renders
   * it: the DDL path quotes and escapes it for the dialect being generated,
   * the runtime path serializes it only when the column stores JSON. Returning
   * nothing keeps the primitive's default.
   *
   * The field is passed as declared, so the value can honour the options on it
   * — a document field restricted to one kind can seed a document of that kind
   * rather than a generic one.
   */
  emptyValue?: (field: PluginFieldInstance) => unknown;
}

/** A type-only import a generated file needs for one field type's expressions. */
export interface PluginFieldCodegenImport {
  /** Names to import, e.g. `["BlockDocument"]`. */
  names: readonly string[];
  /**
   * Module to import them from.
   *
   * Name a package the app already depends on. The generated file sits in the
   * app, not in the plugin, so it resolves against the app's dependency tree —
   * an import of a plugin's own transitive dependency may not resolve there.
   */
  from: string;
}

/** How a plugin field type is rendered by the code generators. */
export interface PluginFieldCodegen {
  /**
   * The TypeScript type of a stored value, e.g. `"BlockDocument"` or
   * `'"draft" | "live"'`. Omitted falls back to the storage primitive's type.
   */
  tsType?: (field: PluginFieldInstance) => string;
  /**
   * Type-only imports `tsType` relies on.
   *
   * Declared per expression rather than once for both, because the two are
   * emitted into different files. A name listed here appears only in the
   * TypeScript output, so an app compiled with `noUnusedLocals` does not fail on
   * an import the other file never uses.
   */
  tsImports?: readonly PluginFieldCodegenImport[];
  /**
   * A Zod expression validating a stored value, e.g.
   * `"z.object({ kind: z.enum([\"page\"]) })"`. Omitted falls back to the
   * storage primitive's schema.
   */
  zodSchema?: (field: PluginFieldInstance) => string;
  /** Type-only imports `zodSchema` relies on, e.g. for `z.custom<Rating>()`. */
  zodImports?: readonly PluginFieldCodegenImport[];
}

/** What a plugin field type's `validate` is given. */
export interface PluginFieldValidateArgs {
  /**
   * The write payload, for rules that span fields — the whole object on
   * create, and on update the patch rather than the merged stored entry, so a
   * field the writer did not send is absent here even when it has a stored
   * value. Always the top-level payload: a field nested in a repeater row or
   * group still sees the write, not the row.
   */
  data: Record<string, unknown>;
  /**
   * Request context; carries `user` when the write is authenticated. The
   * parent write's request, forwarded unchanged, including to a field nested
   * inside a component instance — which is validated by its own pass, in its
   * own service, so the context has to be carried there rather than being in
   * scope already.
   *
   * Empty for a write with no request behind it: an internal write, a seed,
   * or an unauthenticated one.
   */
  req: Record<string, unknown>;
  /**
   * The field instance, so a validator can read the options its own type
   * declares (a `rating`'s `max`, a `blocks`' `allow`).
   *
   * A detached copy: records, arrays, dates, sets and maps are all rebuilt, so
   * editing them changes nothing the next write sees. The exceptions are what
   * cannot be copied without becoming something else — a function, and an
   * instance of a class core has no constructor for — which stay shared. Treat
   * the whole thing as read-only.
   */
  field: PluginFieldInstance;
  /**
   * Where this field sits in the write (`"stars"`, `"rows[2].stars"`).
   * Returned issue paths are used as given, so prefix with this to point
   * inside a value; a validator has no other way to know its own location.
   */
  path: string;
  /** `create` requires absent values; `update` treats them as untouched. */
  mode: "create" | "update";
}

/**
 * A field as the validation pass sees it.
 *
 * Deliberately loose: one pass runs over both code-first field configs and
 * stored runtime definitions, whose option shapes differ, so a validator reads
 * its own options rather than being handed a narrowed type that would be a
 * lie for one of the two.
 */
export interface PluginFieldInstance {
  name?: string;
  type: string;
  label?: unknown;
  required?: boolean;
  readonly [option: string]: unknown;
}

/** One problem with a stored value. */
export interface PluginFieldIssue {
  /**
   * Where the problem is, used exactly as given. Defaults to the field's own
   * path; supply one to point inside a structured value, building it from
   * `args.path` so it stays right for a nested instance
   * (`` `${args.path}.nodes[2].props.level` ``).
   */
  path?: string;
  /** Stable machine code for clients to branch on. Defaults to `"CUSTOM"`. */
  code?: string;
  /** A complete sentence. A trailing period is added when missing. */
  message: string;
}

export type PluginFieldValidationResult = true | string | PluginFieldIssue[];

/**
 * @public A permission identifier — the `${action}-${resource}` slug
 * (e.g. `'export-submissions'`).
 *
 * When generated types exist (run `nextly generate:types`), this narrows to the
 * union of seeded permission slugs (CRUD per collection/single + custom plugin/
 * app permissions, D36/D47). Without generated types — or when no permissions
 * are present — it falls back to `string` (same convention as `CollectionSlug`).
 */
export type PermissionSlug = GeneratedTypes extends { permissions: infer P }
  ? keyof P & string
  : string;

/**
 * Declarative, introspectable plugin contributions. The host can read these
 * WITHOUT running the plugin.
 *
 * @public Each key is *consumed* by a phase: collections/singles/components/
 * extend → P2 (merge pipeline); permissions → P3; events → P1; routes → P4;
 * admin → P5 (menu/pages/settings/views; widgets reserved for M8).
 */
export interface PluginContributions {
  /** @public New plugin-owned collections. Merged by the schema pipeline. */
  collections?: CollectionConfig[];
  /** @public New plugin-owned singles. */
  singles?: SingleConfig[];
  /** @public Plugin-owned field groups. */
  fieldGroups?: FieldGroupConfig[];
  /**
   * @public Add fields to existing entities by slug.
   *
   * Authored fields, not canonical ones: `collections`, `singles` and
   * `fieldGroups` each arrive through a `define*` call that has already
   * narrowed them, while these are written inline with nothing to narrow them,
   * so a plugin's own contributed type has to be nameable here.
   */
  extend?: Array<{
    target: string | string[];
    fields: AuthorableFieldConfig[];
  }>;
  /** @public Custom permissions; CRUD is auto-seeded separately. */
  permissions?: PluginPermission[];
  /** @experimental Role bundles — named sets of permissions, seeded on boot. */
  roles?: PluginRole[];
  /**
   * @experimental Background job types this plugin can run.
   *
   * Each entry is a `defineJob(...)` result. Registered with the runtime job
   * registry at boot, which is what makes the handler reachable: a definition
   * that never reaches the registry is queueable and unrunnable, and silently
   * so — the enqueue succeeds and every drain defers the row forever.
   */
  jobs?: JobDefinition[];
  /**
   * @experimental Custom services registered into DI. Each entry is a
   * factory `(ctx) => instance`; the service is exposed lazily (instantiated on
   * first access) at `ctx.services.plugins.<thisPluginName>.<key>` and
   * `nextly.plugins.<thisPluginName>.<key>`. Other plugins consume it via
   * their own `ctx.services.plugins.<name>.<key>`.
   */
  services?: Record<string, (ctx: PluginContext) => unknown>;
  /**
   * @experimental Static data this plugin publishes for OTHER plugins, keyed by
   * the consuming plugin's name. Core stores it and never reads inside it.
   *
   * The counterpart to `services`, and the reason it exists: a service is a
   * factory, so its contents are knowable only once a plugin's `init` has run.
   * Everything else here is plain data, which is what lets `nextly generate:types`
   * build generated artifacts by reading the config alone — it loads no plugin
   * runtime and opens no database. A capability offered only through `services`
   * is therefore invisible to generation, and cannot appear in an import map, a
   * manifest, or generated types.
   *
   * Declaring the data here and registering FROM it at boot keeps one source for
   * both, so tooling and runtime cannot disagree about what a plugin provides.
   *
   * Keyed by consumer name rather than by capability so core stays out of it:
   * a page builder reads `declarations["@nextlyhq/plugin-page-builder"]` and
   * decides what its own shape means, exactly as it already does for the
   * service it hands back.
   *
   * @example
   * ```ts
   * contributes: {
   *   declarations: {
   *     "@nextlyhq/plugin-page-builder": { blocks: [pricingTable] },
   *   },
   * }
   * ```
   */
  declarations?: Record<string, unknown>;
  /**
   * @experimental Scheduled tasks — **RESERVED, NOT EXECUTED** in this
   * release. The shape is published so authors aren't surprised by its absence,
   * but the runtime does not run these yet (a real scheduler needs durable jobs,
   * D51, because the typical Next.js/serverless deploy has no long-lived
   * process). Until then: trigger work via an external cron service hitting a
   * route handler, or react to events (e.g. for cache
   * invalidation). See `docs/plugins`.
   */
  schedules?: ScheduledTask[];
  /** @experimental Custom email providers, registered into the provider registry. */
  emailProviders?: PluginEmailProvider[];
  /** @experimental Email templates, seeded idempotently into the DB on boot. */
  emailTemplates?: PluginEmailTemplate[];
  /** @experimental Custom field types — registry seam mapping to a storage primitive + admin component. */
  fieldTypes?: PluginFieldType[];
  /** @experimental Custom event names this plugin may emit. No first-party plugin declares custom events yet. */
  events?: Array<{ name: string }>;
  /** @public HTTP routes, namespaced under /api/plugins/<name>. */
  routes?: PluginRoute[];
  /**
   * @public Admin UI contributions: menu, pages +
   * settings, per-collection view overrides. `widgets` is
   * RESERVED — deferred; not rendered and stays `@experimental`.
   */
  admin?: PluginAdminContributions;
  /**
   * @experimental Auth extensibility: auth-flow hooks, challenge
   * definitions, and auth-page UI. Strategies are app-opt-in (defineConfig
   * `auth.strategies`), not here.
   */
  auth?: PluginAuthContributions;
}
