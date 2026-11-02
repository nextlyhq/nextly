/**
 * `nextly users:create-admin` — create the install's first administrator from
 * the command line, against the install's own database.
 *
 * It needs no setup token: whoever can run it already holds the database
 * credentials, which are worth more than the token. It refuses, creating
 * nothing, once the install has an administrator, and still bootstraps an
 * install whose only accounts are role-less self-registered ones, as web
 * setup does.
 *
 * ## The password is never an argument
 *
 * A command-line argument lands in shell history and in the process list, so
 * the password comes from `NEXTLY_ADMIN_PASSWORD` or from a prompt that does
 * not echo it, and nowhere else. It is held to the same strength rules as
 * setup's.
 *
 * ## One first administrator
 *
 * The command takes the same one-setup-at-a-time claim web setup takes, asks
 * under it whether an administrator exists, creates the account, and spends
 * any stored setup token, as web setup does. All of that goes through
 * {@link FirstAdminSetup}, so the command's own logic is the same whatever
 * backs it.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/create-admin
 * @example
 * ```bash
 * nextly users:create-admin --email admin@example.com --name "Ada Admin"
 * NEXTLY_ADMIN_PASSWORD=... nextly users:create-admin --email admin@example.com --name "Ada Admin"
 * ```
 */

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { normalizeAccountEmail } from "../../auth/credentials/account-email";
import {
  DEFAULT_MIN_PASSWORD_LENGTH,
  setMinPasswordLength,
  validatePasswordStrength,
} from "../../auth/password";
import { claimFirstSetup } from "../../auth/setup-token/setup-gate";
import {
  spendSetupToken,
  type SetupTokenMeta,
} from "../../auth/setup-token/setup-token";
import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { seedPermissions } from "../../database/seeders/permissions";
import { seedSuperAdmin } from "../../database/seeders/super-admin";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import { MetaService } from "../../domains/meta/services/meta-service";
import {
  isFirstAdministratorTaken,
  superAdminRoleHeld,
} from "../../domains/users/services/last-super-admin";
import { NextlyError } from "../../errors/nextly-error";
import { failWithError, printCliError, type CliError } from "../errors";
import {
  adminEmailInUse,
  adminEmailInvalid,
  adminNameMissing,
  adminPasswordMissing,
  adminPasswordsDiffer,
  adminPasswordTooWeak,
  setupAlreadyComplete,
  setupInProgress,
} from "../errors/areas/commands";
// Types only: the program hands this module its context factory, so this
// module adds no runtime import of the program that registers it.
import type { CommandContext, GlobalOptions } from "../program";
import { createCliAdapter } from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";

export const CREATE_ADMIN_COMMAND = "users:create-admin";

/** Where the password is read from when no prompt can ask for it. */
export const ADMIN_PASSWORD_ENV = "NEXTLY_ADMIN_PASSWORD";

/** The first administrator's details, the password among them. */
export interface FirstAdminDetails {
  email: string;
  name: string;
  password: string;
}

/**
 * What creating the first administrator asks of the install: one setup at a
 * time, whether an administrator exists, creating one, and spending any
 * stored setup token.
 */
export interface FirstAdminSetup {
  /** Take the one-setup-at-a-time claim; `null` while another setup holds it. */
  claim(): Promise<{ release(): void | Promise<void> } | null>;
  /** Whether anyone holds the administrator role already. */
  administratorExists(): Promise<boolean>;
  /** Whether an account already has this email, spelled as sign-in spells it. */
  accountExists(email: string): Promise<boolean>;
  /**
   * Create the account as the first administrator, or create nothing: the
   * refusal says whether an administrator came first or the email was taken
   * meanwhile.
   */
  createAdministrator(details: FirstAdminDetails): Promise<CreationOutcome>;
  spendSetupToken(): Promise<void>;
}

/** How creating the account itself ended. */
export type CreationOutcome =
  | "created"
  | "administrator-exists"
  | "email-in-use";

/** How a creation attempt ended. */
export type FirstAdminOutcome = CreationOutcome | "setup-in-progress";

/**
 * Create the first administrator, under the setup claim, unless one exists.
 * The claim is released however this ends.
 */
export async function createFirstAdministrator(
  setup: FirstAdminSetup,
  details: FirstAdminDetails
): Promise<FirstAdminOutcome> {
  const claim = await setup.claim();
  if (claim === null) return "setup-in-progress";
  try {
    if (await setup.administratorExists()) return "administrator-exists";
    // An existing account would be given the role and keep its own password,
    // so the password just typed would be ignored without a word.
    if (await setup.accountExists(details.email)) return "email-in-use";
    // The checks above answer the common case without writing; creation
    // still refuses for itself, since an administrator or an account can
    // appear between them and the insert.
    const created = await setup.createAdministrator(details);
    if (created !== "created") return created;
    await setup.spendSetupToken();
    return "created";
  } finally {
    await claim.release();
  }
}

/** The narrow view of the query builder the email check reads through. */
interface AccountLookup {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<Array<{ id: unknown }>>;
      };
    };
  };
}

/**
 * The first-administrator steps over the CLI's own connection. `meta` is the
 * install's `nextly_meta` row store, where web setup keeps its claim and its
 * token, so the command and a web setup arriving together share one claim.
 */
export function firstAdminSetupFor(
  adapter: DrizzleAdapter,
  meta: SetupTokenMeta
): FirstAdminSetup {
  const tables = getDialectTables(adapter.getCapabilities().dialect);
  return {
    // The claim web setup takes, so exactly one of them proceeds.
    claim: () => claimFirstSetup(meta),
    // The question web setup asks, through the same query.
    administratorExists: () => superAdminRoleHeld(adapter.getDrizzle(), tables),
    async accountExists(email) {
      const db = adapter.getDrizzle<AccountLookup>();
      const rows = await db
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(eq(tables.users.email, normalizeAccountEmail(email)))
        .limit(1);
      return rows.length > 0;
    },
    async createAdministrator(details) {
      // The path web setup creates its administrator through. The permission
      // rows first, which the role's grant needs.
      await seedPermissions(adapter, { silent: true });
      // Then the account, as setup's: it becomes the first administrator
      // through the grant made under the role row's lock, inside the insert's
      // transaction, or is not created at all, so a command that loses to
      // another setup leaves no account and announces none.
      // Loaded here, as web setup loads it: the service graph is large, and
      // every other CLI command would pay for it at start.
      const { ServiceContainer } = await import("../../services/index");
      try {
        await new ServiceContainer(adapter).users.createLocalUser(
          {
            email: details.email,
            name: details.name,
            password: details.password,
            isActive: true,
            emailVerification: "admin-vouched",
          },
          undefined,
          "setup"
        );
      } catch (error) {
        if (isFirstAdministratorTaken(error)) return "administrator-exists";
        if (NextlyError.is(error) && error.code === "DUPLICATE") {
          return "email-in-use";
        }
        throw error;
      }
      // The role's permissions; the account already holds the role.
      const result = await seedSuperAdmin(adapter, {
        ...details,
        silent: true,
        assignRole: false,
      });
      if (!result.success) {
        throw NextlyError.internal({
          logContext: {
            reason: "first-admin-create-failed",
            detail: result.errorMessages?.[0],
          },
        });
      }
      return "created";
    },
    // Web setup spends the stored token once it has its administrator; so
    // does the command, so no token is left to open setup again.
    spendSetupToken: () => spendSetupToken(meta),
  };
}

/** What the command reads from outside: its environment and its terminal. */
export interface CreateAdminIo {
  env: Record<string, string | undefined>;
  /** Whether a person can be asked: a terminal on both ends. */
  interactive: boolean;
  /** Ask for a value that is not echoed; `null` when the person cancels. */
  askSecret(message: string): Promise<string | null>;
  /** Ask for a value; `null` when the person cancels. */
  ask(message: string): Promise<string | null>;
  /** Connect to the install's database: its steps, and how to let it go. */
  connect(): Promise<{ setup: FirstAdminSetup; close(): Promise<void> }>;
}

/** The flags the command takes. There is no password flag, by design. */
export interface CreateAdminOptions {
  email?: string;
  name?: string;
}

const EmailSchema = z.string().trim().email();

/** A value from its flag, or from the person when one can be asked. */
async function valueOf(
  given: string | undefined,
  label: string,
  io: CreateAdminIo
): Promise<string | null> {
  if (given?.trim()) return given.trim();
  if (!io.interactive) return null;
  return (await io.ask(label))?.trim() || null;
}

/**
 * The password from the environment, or from two matching answers at a
 * prompt. `null` when neither can give one, `undefined` when the answers
 * differ.
 */
export async function readAdminPassword(
  io: CreateAdminIo
): Promise<string | null | undefined> {
  const fromEnv = io.env[ADMIN_PASSWORD_ENV];
  if (fromEnv) return fromEnv;
  if (!io.interactive) return null;
  const first = await io.askSecret("Password");
  if (first === null) return null;
  const again = await io.askSecret("Password again");
  return again === first ? first : undefined;
}

/** What each refused outcome ends the command with. */
const REFUSALS: Record<
  Exclude<FirstAdminOutcome, "created">,
  () => CliError
> = {
  "administrator-exists": () => setupAlreadyComplete(CREATE_ADMIN_COMMAND),
  "email-in-use": adminEmailInUse,
  "setup-in-progress": () => setupInProgress(CREATE_ADMIN_COMMAND),
};

/** The details, or the reason they cannot be had, as the command's error. */
async function gatherDetails(
  options: CreateAdminOptions,
  io: CreateAdminIo
): Promise<FirstAdminDetails | { problem: CliError }> {
  const email = await valueOf(options.email, "Email", io);
  if (email === null || !EmailSchema.safeParse(email).success) {
    return { problem: adminEmailInvalid(email) };
  }
  const name = await valueOf(options.name, "Name", io);
  if (name === null) return { problem: adminNameMissing() };
  const password = await readAdminPassword(io);
  if (password === undefined) return { problem: adminPasswordsDiffer() };
  if (password === null) {
    return { problem: adminPasswordMissing(ADMIN_PASSWORD_ENV) };
  }
  return { email, name, password };
}

/**
 * Prints `error` in the error shape and answers the failing code, 1. The
 * command resolves to its exit code rather than exiting, so the shape is
 * printed here and the code is the caller's to set.
 */
function refuse(logger: CommandContext["logger"], error: CliError): number {
  printCliError(logger, error);
  return 1;
}

/**
 * Run the command; resolves to its exit code. Everything outside the
 * command comes through `io`, so it can be driven without a terminal.
 */
export async function runCreateAdmin(
  options: CreateAdminOptions,
  context: CommandContext,
  io: CreateAdminIo
): Promise<number> {
  const { logger } = context;
  const details = await gatherDetails(options, io);
  if ("problem" in details) return refuse(logger, details.problem);
  const connection = await io.connect();
  try {
    // The connect loads the install's config, which publishes the configured
    // minimum the password rule judges against — so the check runs after it,
    // not before, or an install that raised its minimum would be judged by
    // the default.
    const strength = validatePasswordStrength(details.password);
    if (!strength.ok) {
      return refuse(logger, adminPasswordTooWeak(strength.errors));
    }
    const outcome = await createFirstAdministrator(connection.setup, details);
    if (outcome !== "created") return refuse(logger, REFUSALS[outcome]());
    logger.success(
      `Created the first administrator. Sign in as ${details.email}.`
    );
    return 0;
  } finally {
    await connection.close();
  }
}

/**
 * Connect to the database the install's environment names, with the system
 * tables registered so the account services can resolve them.
 */
export async function connectToInstall(context: CommandContext): Promise<{
  setup: FirstAdminSetup;
  close(): Promise<void>;
}> {
  const { logger } = context;
  // The config first, as every command that reads the database loads it: it
  // publishes the configured PostgreSQL schema the connection resolves in, so
  // an install in `cms` gets its administrator there, not in `public`.
  const loadConfigResult = await loadConfig({
    configPath: context.options.config,
    cwd: context.options.cwd,
  });
  // Publish the configured minimum before any password is judged: the rule
  // reads process state, and the CLI is the one place that judges a password
  // without the app's service registration having set it.
  setMinPasswordLength(
    loadConfigResult.config.auth?.minPasswordLength ??
      DEFAULT_MIN_PASSWORD_LENGTH
  );
  // The settings are the operator's own, so the error names the first one to fix, under the
  // code every command reports it with.
  const database = databaseEnvOrThrow();
  const dialectSetting = database.dialect;
  // A failure here already carries its code: `createCliAdapter` gives it one.
  const cli = await createCliAdapter({
    dialect: dialectSetting,
    databaseUrl: database.databaseUrl,
  });
  const adapter = cli as unknown as DrizzleAdapter;
  const { dialect } = adapter.getCapabilities();
  const registry = new SchemaRegistry(dialect);
  registry.registerStaticSchemas({
    ...getDialectTables(dialect),
    ...getFieldGroupRegistryAliases(dialect),
  });
  adapter.setTableResolver(registry);
  return {
    setup: firstAdminSetupFor(adapter, new MetaService(adapter, logger)),
    close: () => cli.disconnect(),
  };
}

/** The terminal and environment the command runs with. */
function processIo(context: CommandContext): CreateAdminIo {
  const answer = (value: string | symbol): string | null =>
    p.isCancel(value) ? null : value;
  return {
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    askSecret: async message => answer(await p.password({ message })),
    ask: async message => answer(await p.text({ message })),
    connect: () => connectToInstall(context),
  };
}

/** Register `nextly users:create-admin`. */
export function registerCreateAdminCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  program
    .command(CREATE_ADMIN_COMMAND)
    .description(
      `Create the first administrator in this install's database (password from ${ADMIN_PASSWORD_ENV} or a prompt)`
    )
    .option("--email <email>", "The administrator's email")
    .option("--name <name>", "The administrator's name")
    .action(async (options: CreateAdminOptions, cmd: Command) => {
      const context = createContext(cmd.optsWithGlobals());
      try {
        process.exitCode = await runCreateAdmin(
          options,
          context,
          processIo(context)
        );
      } catch (error) {
        failWithError(context.logger, error);
      }
    });
}
