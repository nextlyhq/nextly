// The usage-data catalog: every event the installer, the `nextly` CLI and a
// running site may send, and every property each may carry, with the values
// each property allows. Nothing outside this file can be sent:
//
// - the event and property types below are derived from this one constant,
//   so naming another event or property does not compile;
// - the sender checks each event against it again at run time and drops a
//   property it does not list, or an event whose required value is wrong;
// - `usageCatalogData()` hands the same constant, as plain data, to the docs
//   page and the ingest check, so all three read one list.
//
// Strings are the risky values, because a name, a path or a message is a
// string. A string property is therefore either one of a fixed list or a
// tight pattern (a version, a random id, a command's generic name, a stable
// error code), never free text.
//
// Shared value lists are referenced as `X as typeof X` because the package's
// declarations are written without a type checker (`isolatedDeclarations`),
// which cannot see the type of a bare reference inside an object literal.

/** The catalog's own version. Version 1 is the earlier CLI-only catalog. */
export const CATALOG_VERSION = 2;

/**
 * The installer's and CLI's notice version. The notice is shown again on each
 * machine when this rises, and it must rise whenever the catalog adds an
 * event or a property the installer or the CLI sends (enforced by
 * `__tests__/notice-version.test.ts`). Version 1 is the earlier, unversioned
 * notice, so this catalog, which also counts agent runs, runs with no
 * terminal and runs in Docker, starts at 2.
 */
export const TOOLS_NOTICE_VERSION = 2;

/**
 * The site notice version: people who may change a site's switch are told
 * once in the admin when it rises. It must rise whenever the catalog adds an
 * event or a property a site sends (same test).
 */
export const SITE_NOTICE_VERSION = 1;

const USAGE_SOURCES = ["installer", "cli", "site"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];
/** The two sources a person or an agent runs on their own machine. */
export type ToolsSource = Exclude<UsageSource, "site">;

const RUN_BY = ["person", "agent"] as const;

/**
 * Coding agents recognised by their environment markers (`agent.ts`). Any
 * other agent, or an `AI_AGENT` value not on this list, is sent as `other`.
 */
export const AGENT_NAMES = [
  "antigravity",
  "augment-cli",
  "claude",
  "codex",
  "cowork",
  "cursor",
  "cursor-cli",
  "devin",
  "eve",
  "fx",
  "gemini",
  "github-copilot",
  "opencode",
  "replit",
  "v0",
  "other",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

const OS_NAMES = ["darwin", "linux", "win32", "freebsd", "other"] as const;
const ARCH_NAMES = ["arm64", "x64", "other"] as const;
const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun", "unknown"] as const;

/**
 * The page an install command was copied from (`create-nextly-app --from`).
 * `other` for a label not on the list, `none` when no label was given.
 */
export const PAGE_LABELS = [
  "home",
  "quickstart",
  "installation",
  "docs",
  "blog",
  "llms",
  "readme",
  "other",
  "none",
] as const;

/** The installer's sections, each sent as one `install_step` when answered. */
export const INSTALL_SECTIONS = [
  "project",
  "hosting_and_data",
  "features",
  "coding_tools",
] as const;

/**
 * Where an install can stop: a section, the review, or a creation step. The
 * sections are written out again (declarations here cannot be inferred from a
 * spread); `catalog-lists.test.ts` holds the two lists together.
 */
export const INSTALL_STEPS = [
  "project",
  "hosting_and_data",
  "features",
  "coding_tools",
  "review",
  "create_files",
  "install_dependencies",
  "set_up_database",
  "finish",
] as const;

export const STARTS = ["website", "blank", "plugin"] as const;
export const HOSTS = ["not_sure", "vercel", "own_server"] as const;
export const DATABASES = ["sqlite", "postgresql", "mysql"] as const;
export const FEATURES = ["page_builder", "seo", "forms", "languages"] as const;
export const CODING_TOOLS = ["claude_code", "cursor", "codex"] as const;

/**
 * Why an install failed. A cancel after the start notice is a failure with
 * `cancelled`. The rest are the codes `classifyError` already returns.
 */
export const INSTALL_ERROR_CODES = [
  "cancelled",
  "install_failed",
  "install_network",
  "install_permission",
  "install_disk_full",
  "template_download_failed",
  "template_parse_failed",
  "config_generation_failed",
  "db_connection_failed",
  "migration_conflict",
  "unknown",
] as const;

/** The CLI's exit codes, the same for every command. */
export const EXIT_CODES = [0, 1, 2, 3, 4, 5, 130] as const;

/** A site's role. A CLI command with no target site reports `none`. */
export const SITE_ROLES = [
  "local",
  "preview",
  "staging",
  "production",
] as const;
// The site roles, written out again for the same reason as INSTALL_STEPS.
export const COMMAND_ROLES = [
  "local",
  "preview",
  "staging",
  "production",
  "none",
] as const;

/**
 * "How did you hear about Nextly?" on the first-admin screen: `skipped` when
 * the person skipped it, `not_asked` when the first admin was made headless.
 */
export const HEARD_FROM = [
  "search",
  "friend",
  "youtube",
  "x",
  "ai_assistant",
  "other",
  "skipped",
  "not_asked",
] as const;

/** Counts in a daily summary are sent as one of these ranges, never exactly. */
export const COUNT_RANGES = [
  "0",
  "1-10",
  "11-100",
  "101-1000",
  "1001-10000",
  "more",
] as const;

// ---------------------------------------------------------------------------
// Property kinds
// ---------------------------------------------------------------------------

/** One of a fixed list of values. */
export interface EnumProperty<V extends string | number = string | number> {
  readonly type: "enum";
  readonly values: readonly V[];
}
/** `true` or `false`. */
export interface BooleanProperty {
  readonly type: "boolean";
}
/** A whole number within a range. */
export interface IntegerProperty {
  readonly type: "integer";
  readonly min: number;
  readonly max: number;
}
/** Several values, each from a fixed list, each at most once. */
export interface ListProperty<V extends string = string> {
  readonly type: "list";
  readonly values: readonly V[];
}
/**
 * A string matching a pattern, for values that cannot be listed in advance
 * but must not be free text: a version, a random id, a stable error code.
 */
export interface PatternProperty {
  readonly type: "pattern";
  readonly pattern: string;
  readonly maxLength: number;
}
/** Several strings, each matching a pattern, each at most once. */
export interface PatternListProperty {
  readonly type: "pattern-list";
  readonly pattern: string;
  readonly maxLength: number;
  readonly maxItems: number;
}

export type PropertySpec =
  | EnumProperty
  | BooleanProperty
  | IntegerProperty
  | ListProperty
  | PatternProperty
  | PatternListProperty;

export interface EventSpec {
  readonly sources: readonly UsageSource[];
  readonly required: Readonly<Record<string, PropertySpec>>;
  readonly optional: Readonly<Record<string, PropertySpec>>;
}

// ---------------------------------------------------------------------------
// Shared property specs
// ---------------------------------------------------------------------------

const BOOLEAN = { type: "boolean" } as const;
const DURATION_MS = { type: "integer", min: 0, max: 2_147_483_647 } as const;
/** A random 128-bit id written as 32 lowercase hex characters. */
const RANDOM_ID = {
  type: "pattern",
  pattern: "^[0-9a-f]{32}$",
  maxLength: 32,
} as const;
const VERSION = {
  type: "pattern",
  pattern:
    "^\\d{1,4}\\.\\d{1,4}\\.\\d{1,6}(?:-[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*)?$",
  maxLength: 40,
} as const;
const RANGE = {
  type: "enum",
  values: COUNT_RANGES,
} as const;
const ANSWERS = {
  start: { type: "enum", values: STARTS },
  host: { type: "enum", values: HOSTS },
  database: { type: "enum", values: DATABASES },
  features: { type: "list", values: FEATURES },
  coding_tools: { type: "list", values: CODING_TOOLS },
} as const;

/**
 * Every installer and CLI event carries these, added by the session, never
 * by the caller.
 */
export const TOOLS_BASE_PROPERTIES = {
  required: {
    source: { type: "enum", values: ["installer", "cli"] },
    catalog_version: {
      type: "enum",
      values: [CATALOG_VERSION as typeof CATALOG_VERSION],
    },
    nextly_version: VERSION,
    run_by: { type: "enum", values: RUN_BY },
    os: { type: "enum", values: OS_NAMES },
    arch: { type: "enum", values: ARCH_NAMES },
    package_manager: {
      type: "enum",
      values: PACKAGE_MANAGERS,
    },
    node_major: { type: "integer", min: 0, max: 999 },
  },
  optional: {
    agent: { type: "enum", values: AGENT_NAMES },
  },
} as const;

/** Every site event carries these, added by the session. */
export const SITE_BASE_PROPERTIES = {
  required: {
    source: { type: "enum", values: ["site"] },
    catalog_version: {
      type: "enum",
      values: [CATALOG_VERSION as typeof CATALOG_VERSION],
    },
    nextly_version: VERSION,
    role: { type: "enum", values: SITE_ROLES },
  },
  optional: {},
} as const;

// ---------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------

export const USAGE_EVENTS = {
  install_started: {
    sources: ["installer"],
    required: {
      from: { type: "enum", values: PAGE_LABELS },
      terminal: BOOLEAN,
    },
    optional: { install_id: RANDOM_ID },
  },
  install_step: {
    sources: ["installer"],
    required: {
      section: {
        type: "enum",
        values: INSTALL_SECTIONS,
      },
    },
    optional: {
      start: ANSWERS.start,
      host: ANSWERS.host,
      database: ANSWERS.database,
      features: ANSWERS.features,
      coding_tools: ANSWERS.coding_tools,
      install_id: RANDOM_ID,
    },
  },
  install_completed: {
    sources: ["installer"],
    required: { duration_ms: DURATION_MS },
    optional: {
      start: ANSWERS.start,
      host: ANSWERS.host,
      database: ANSWERS.database,
      features: ANSWERS.features,
      coding_tools: ANSWERS.coding_tools,
      install_id: RANDOM_ID,
    },
  },
  install_failed: {
    sources: ["installer"],
    required: {
      step: { type: "enum", values: INSTALL_STEPS },
      error_code: {
        type: "enum",
        values: INSTALL_ERROR_CODES,
      },
      duration_ms: DURATION_MS,
    },
    optional: { install_id: RANDOM_ID },
  },
  command_run: {
    sources: ["cli"],
    required: {
      // The command's generic name from the CLI's operation list: up to four
      // lowercase words ("schema pull", "content create", "plugin command",
      // "unknown"), or a Nextly plugin's package name. The operation list,
      // not this pattern, is what reduces a generated or third-party command
      // to its generic shape.
      command: {
        type: "pattern",
        pattern:
          "^(?:[a-z][a-z0-9-]{0,31}(?: [a-z][a-z0-9-]{0,31}){0,3}|@nextlyhq/[a-z0-9-]{1,60})$",
        maxLength: 80,
      },
      alias: BOOLEAN,
      role: { type: "enum", values: COMMAND_ROLES },
    },
    optional: {
      duration_ms: DURATION_MS,
      exit_code: { type: "enum", values: EXIT_CODES },
      // A stable error code ("VALIDATION_ERROR"), never a message.
      error_code: {
        type: "pattern",
        pattern: "^[A-Z][A-Z0-9_]{1,63}$",
        maxLength: 64,
      },
    },
  },
  admin_first_opened: {
    sources: ["site"],
    required: {
      heard_from: { type: "enum", values: HEARD_FROM },
      run_by: { type: "enum", values: RUN_BY },
    },
    optional: {
      agent: { type: "enum", values: AGENT_NAMES },
      install_id: RANDOM_ID,
    },
  },
  first_collection_created: {
    sources: ["site"],
    required: {},
    optional: { install_id: RANDOM_ID },
  },
  first_page_published: {
    sources: ["site"],
    required: {},
    optional: { install_id: RANDOM_ID },
  },
  daily_summary: {
    sources: ["site"],
    required: {
      database: { type: "enum", values: DATABASES },
      collections: RANGE,
      singles: RANGE,
      published_documents: RANGE,
      // Nextly's own plugins by package name; every other plugin only counted.
      plugins_official: {
        type: "pattern-list",
        pattern: "^@nextlyhq/[a-z0-9-]{1,60}$",
        maxLength: 70,
        maxItems: 50,
      },
      plugins_other: { type: "integer", min: 0, max: 10_000 },
    },
    optional: {},
  },
} as const;

/**
 * The id every event is sent under: a machine's random id (64 hex
 * characters) from the installer and the CLI, a site's (32) from a site.
 */
export const DISTINCT_ID_PATTERN = "^[0-9a-f]{32}(?:[0-9a-f]{32})?$";

/**
 * Properties PostHog reads as instructions rather than data, added to every
 * event by the sender: make no person profile for this id, and look up no
 * location.
 */
export const TRANSPORT_PROPERTIES = {
  $process_person_profile: false,
  $geoip_disable: true,
} as const;

// ---------------------------------------------------------------------------
// Types derived from the catalog
// ---------------------------------------------------------------------------

type Catalog = typeof USAGE_EVENTS;
export type UsageEventName = keyof Catalog;

/** The events a source may send. */
export type UsageEventFor<S extends UsageSource> = {
  [E in UsageEventName]: S extends Catalog[E]["sources"][number] ? E : never;
}[UsageEventName];

/** The value a property spec allows. */
export type ValueOf<P> = P extends {
  type: "enum";
  values: readonly (infer V)[];
}
  ? V
  : P extends { type: "boolean" }
    ? boolean
    : P extends { type: "integer" }
      ? number
      : P extends { type: "list"; values: readonly (infer V)[] }
        ? readonly V[]
        : P extends { type: "pattern" }
          ? string
          : P extends { type: "pattern-list" }
            ? readonly string[]
            : never;

/**
 * What a caller passes for an event: its required properties, and any of its
 * optional ones. The base properties are the session's to add.
 */
export type UsageEventProperties<E extends UsageEventName> = {
  -readonly [K in keyof Catalog[E]["required"]]: ValueOf<
    Catalog[E]["required"][K]
  >;
} & {
  -readonly [K in keyof Catalog[E]["optional"]]?: ValueOf<
    Catalog[E]["optional"][K]
  >;
};
