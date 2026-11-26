/**
 * Every command the program registers, by what it does with the configuration. A command in none
 * of these lists fails `config-validation-every-command.test.ts`, so a new one is placed on
 * purpose: checked with the rest, or left out with its reason.
 */

/** The commands that read the app's entities, each as it is typed after `nextly`. */
export const READ_ENTITIES: ReadonlyArray<readonly string[]> = [
  ["generate:types"],
  ["migrate:check"],
  ["migrate:create", "--name", "add_notes"],
  ["migrate:status"],
  ["migrate"],
  ["migrate:baseline"],
  ["migrate:resolve", "--applied", "0001_init.sql"],
  ["migrate:fresh"],
  ["migrate:down"],
  ["db:sync"],
  ["build"],
  ["prune"],
  ["i18n:restore", "--collection", "notes"],
  ["workflow:stranded"],
  [
    "workflow:move-stranded",
    "--to",
    "draft",
    "--as",
    "a@example.com",
    "--comment",
    "why",
  ],
  ["media", "reindex-usage"],
  ["repair-columns"],
  ["generate:types", "--check"],
  ["db:sync", "--demote", "notes"],
  ["plugins", "install", "@acme/seo"],
  ["plugins", "uninstall", "@acme/seo"],
];

/**
 * The commands that load the configuration for something other than its entities, such as its
 * plugins, its database schema or its password rule. Each refuses an invalid one alike, and goes
 * on with the defaults where there is none.
 */
export const LOAD_CONFIGURATION: ReadonlyArray<readonly string[]> = [
  ["generate:manifest"],
  ["migrate:field-groups"],
  ["users:clear-plaintext-passwords"],
  ["users:create-admin", "--email", "a@example.com", "--name", "Ada"],
  ["webhooks:prune"],
  ["setup-token"],
  ["permissions:cleanup"],
  ["media", "orphans"],
  ["media", "remove-sizes"],
  ["plugins", "list"],
  ["plugins", "info", "@acme/seo"],
];

/** The commands the check is not asked of, each with why. */
export const NOT_CHECKED: ReadonlyMap<string, string> = new Map([
  ["init", "writes a project's first configuration"],
  ["generate:widget", "writes a widget's files, reading no configuration"],
  ["generate:schema", "a placeholder that does nothing"],
  ["events report", "reads the event tables alone"],
  ["events abandon", "writes the event tables alone"],
  ["i18n:convert-zoned-dates", "reads what the database records alone"],
  ["upgrade", "runs other commands, each checked as itself"],
  ["add", "edits the configuration, and loads it once edited"],
  ["plugins add", "edits the configuration, and loads it once edited"],
  ["telemetry status", "this machine's telemetry setting alone"],
  ["telemetry enable", "this machine's telemetry setting alone"],
  ["telemetry disable", "this machine's telemetry setting alone"],
  ["telemetry reset", "this machine's telemetry setting alone"],
]);
