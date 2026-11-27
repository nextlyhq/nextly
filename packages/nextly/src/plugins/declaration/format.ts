/**
 * The format of a plugin package's declaration: the `nextly` key of its
 * package.json, which says everything the plugin needs before any of its code
 * runs.
 *
 * ```json
 * "nextly": {
 *   "format": 1,
 *   "core": "^0.0.2-alpha.81",
 *   "databases": ["postgresql", "mysql", "sqlite"],
 *   "plugin": { "export": "seoPlugin", "call": true },
 *   "collections": ["redirects"],
 *   "access": { "outbound": ["api.example.com"] }
 * }
 * ```
 *
 * The format carries a number so a Nextly that meets a newer one refuses it
 * rather than misreading it. Format 1 is the first; a change to what a field
 * means, or a new field, is a new number. `plugin` is the registration part,
 * read exactly as it was before the format had a number: a package whose
 * `nextly` key holds only `plugin` is read as it always was.
 *
 * The declaration is a promise, not a grant. A site enforces the plugin's own
 * definition (`definePlugin`); the declaration is compared with it
 * (`comparePluginPackageDeclaration`), and a plugin's own tests run that
 * comparison, so the two cannot drift silently.
 *
 * @experimental The format is new and may change before it is stable; a
 *   change is a new format number.
 *
 * @module plugins/declaration/format
 */
import { z } from "zod";

import { isValidRange } from "../semver-range";

import { PLUGIN_PACKAGE_DECLARATION_FORMAT } from "./format-version";

export { PLUGIN_PACKAGE_DECLARATION_FORMAT };

/** A JavaScript name an import can bind and an object literal can key. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** An npm package name, scoped or not, as npm accepts a new one. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** An environment variable's name, as a shell and a `.env` file both accept it. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** A content type's or table's name: what a slug or a table name may be. */
const NAME = /^[A-Za-z_][\w-]*$/;

/** A command's or agent tool's name: words joined by dots, colons or hyphens. */
const OPERATION_NAME = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/;

/** @experimental A database a plugin can say it works with. */
export const PLUGIN_DATABASE_KINDS = ["postgresql", "mysql", "sqlite"] as const;

/** @experimental A database a plugin can say it works with. */
export type PluginDatabaseKind = (typeof PLUGIN_DATABASE_KINDS)[number];

const text = z.string().trim().min(1, "must not be empty");

const range = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .refine(isValidRange, "must be a version range, such as ^1.2.0");

const packageName = z
  .string()
  .regex(PACKAGE_NAME, "must be an npm package name");

/** A list in which each value appears once. */
function uniqueList<T extends z.ZodType<string>>(item: T) {
  return z
    .array(item)
    .refine(
      values => new Set(values).size === values.length,
      "lists a value more than once"
    );
}

/**
 * A path inside the project, or inside the plugin's package: relative, with
 * forward slashes, never climbing out with `..`. A plugin never writes outside
 * the project folder, so a path that would is refused where it is read.
 */
const relativePath = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .refine(
    path =>
      !path.startsWith("/") &&
      !/^[A-Za-z]:/.test(path) &&
      !path.includes("\\") &&
      !path.split("/").some(part => part === ".." || part === ""),
    "must be a relative path with forward slashes that stays inside its folder"
  );

/** An option the install asks for, given to the plugin's call as a literal. */
const OPTION = z
  .object({
    description: text,
    format: z.enum(["text", "url"]).optional(),
  })
  .strict();

/**
 * The registration part: how the plugin is placed in `nextly.config.ts`.
 * `export` is the export the plugin is (`default` for a default export);
 * `call` says it is a function that makes the plugin, called with the options
 * as one object; `options` are the values the install asks for.
 */
const REGISTRATION = z
  .object({
    export: z
      .string()
      .regex(IDENTIFIER, "`export` must be a JavaScript name, or `default`"),
    call: z.boolean().optional(),
    options: z
      .record(
        z.string().regex(IDENTIFIER, "each option must be a JavaScript name"),
        OPTION
      )
      .optional(),
  })
  .strict()
  .refine(
    declared =>
      declared.call === true ||
      Object.keys(declared.options ?? {}).length === 0,
    "`options` are given to a call, so they need `call: true`"
  );

/**
 * Content types named by slug, or every type of the kinds named except some,
 * as a plugin's `contributes.extend` names its targets.
 */
const CONTENT_TARGET = z.union([
  z.string().regex(NAME, "must be a content type's slug"),
  z
    .object({
      every: z.array(z.enum(["collection", "single"])).min(1),
      except: z.array(z.string().regex(NAME)).optional(),
    })
    .strict(),
]);

const ENV_VAR = z
  .object({
    name: z
      .string()
      .regex(ENV_NAME, "must be an environment variable name, such as API_KEY"),
    description: text,
    required: z.boolean(),
    secret: z.boolean(),
  })
  .strict();

/**
 * A project file the plugin adds: copied from `from` in its package to `to`
 * in the project, never over a file that is already there. With
 * `edit: "wrap"`, an existing project file (such as `next.config.ts`) has its
 * default export wrapped in the function `wrapper` names, where that can be
 * done safely; otherwise the lines to add are printed.
 */
const FILE = z.union([
  z.object({ from: relativePath, to: relativePath }).strict(),
  z
    .object({
      edit: z.literal("wrap"),
      to: relativePath,
      wrapper: z
        .object({
          import: z.string().trim().min(1),
          export: z.string().regex(IDENTIFIER),
        })
        .strict(),
    })
    .strict(),
]);

/** A file of the person's own that stops the plugin working, and why. */
const CONFLICTING_FILE = z
  .object({ path: relativePath, reason: text })
  .strict();

/**
 * What the plugin may access, in the words of `capabilities` (`outbound`,
 * `secrets`, `rawSql`, `login`) plus the content it reads and writes and the
 * public addresses it adds to the site.
 */
const ACCESS = z
  .object({
    content: z
      .object({
        reads: z.array(CONTENT_TARGET).optional(),
        writes: z.array(CONTENT_TARGET).optional(),
      })
      .strict()
      .optional(),
    publicAddresses: uniqueList(
      z.string().regex(/^\/\S*$/, "must be a path starting with /")
    ).optional(),
    outbound: uniqueList(text).optional(),
    secrets: uniqueList(text).optional(),
    rawSql: z.boolean().optional(),
    login: z.boolean().optional(),
  })
  .strict();

const PLUGINS = z
  .object({
    requires: z.record(packageName, range).optional(),
    worksWith: z.record(packageName, range).optional(),
    conflicts: uniqueList(packageName).optional(),
  })
  .strict();

/**
 * A declaration in format 1. Every field but `format`, `core` and `databases`
 * may be left out, and a field left out means none: no tables, no access, no
 * install step.
 */
export const PLUGIN_PACKAGE_DECLARATION_SCHEMA = z
  .object({
    format: z.literal(PLUGIN_PACKAGE_DECLARATION_FORMAT),
    core: range,
    databases: uniqueList(z.enum(PLUGIN_DATABASE_KINDS)).min(
      1,
      "must name at least one database"
    ),
    plugin: REGISTRATION.optional(),
    companions: z.record(packageName, range).optional(),
    plugins: PLUGINS.optional(),
    env: z
      .array(ENV_VAR)
      .refine(
        vars => new Set(vars.map(v => v.name)).size === vars.length,
        "names a variable more than once"
      )
      .optional(),
    tables: uniqueList(z.string().regex(NAME)).optional(),
    collections: uniqueList(z.string().regex(NAME)).optional(),
    singles: uniqueList(z.string().regex(NAME)).optional(),
    extends: z.array(CONTENT_TARGET).optional(),
    files: z.array(FILE).optional(),
    conflictingFiles: z.array(CONFLICTING_FILE).optional(),
    commands: uniqueList(z.string().regex(OPERATION_NAME)).optional(),
    agentTools: uniqueList(z.string().regex(OPERATION_NAME)).optional(),
    steps: z
      .object({ install: z.boolean(), uninstall: z.boolean() })
      .strict()
      .optional(),
    liveSwitch: z.boolean().optional(),
    access: ACCESS.optional(),
    beforeRemove: z.array(text).optional(),
  })
  .strict();

/** The registration part on its own: today's `nextly.plugin` block. */
export const PLUGIN_REGISTRATION_SCHEMA = REGISTRATION;

/** @experimental A plugin package's declaration, in format 1. */
export type PluginPackageDeclaration = z.infer<
  typeof PLUGIN_PACKAGE_DECLARATION_SCHEMA
>;

/** @experimental How the plugin is placed in `nextly.config.ts`. */
export type PluginPackageRegistration = z.infer<typeof REGISTRATION>;

/** @experimental An option the install asks for. */
export type PluginPackageInstallOption = z.infer<typeof OPTION>;

/** @experimental Content types named by slug, or a scope of them. */
export type PluginContentTarget = z.infer<typeof CONTENT_TARGET>;

/**
 * @experimental The declaration's JSON Schema, for editors and other tools
 * that read package.json. What it cannot say (a version range that parses, a
 * path that stays inside its folder, a list without repeats) the reader still
 * checks.
 */
export function pluginPackageDeclarationJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PLUGIN_PACKAGE_DECLARATION_SCHEMA, {
    io: "input",
  });
}
