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
import { validatePasswordStrength } from "../../auth/password";
import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { seedPermissions } from "../../database/seeders/permissions";
import { seedSuperAdmin } from "../../database/seeders/super-admin";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import { superAdminRoleHeld } from "../../domains/users/services/last-super-admin";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
// Types only: the program hands this module its context factory, so this
// module adds no runtime import of the program that registers it.
import type { CommandContext, GlobalOptions } from "../program";
import { createCliAdapter, validateDatabaseEnv } from "../utils/adapter";

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
  createAdministrator(details: FirstAdminDetails): Promise<void>;
  spendSetupToken(): Promise<void>;
}

/** How a creation attempt ended. */
export type FirstAdminOutcome =
  | "created"
  | "administrator-exists"
  | "email-in-use"
  | "setup-in-progress";

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
    await setup.createAdministrator(details);
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

/** The first-administrator steps over the CLI's own connection. */
export function firstAdminSetupFor(adapter: DrizzleAdapter): FirstAdminSetup {
  const tables = getDialectTables(adapter.getCapabilities().dialect);
  return {
    // No setup claim to share in this build: the command alone holds the
    // install while it runs.
    claim: () => Promise.resolve({ release: () => undefined }),
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
      // The path web setup creates its administrator through: the permissions
      // the role is granted, then the account and its role.
      await seedPermissions(adapter, { silent: true });
      const result = await seedSuperAdmin(adapter, {
        ...details,
        silent: true,
      });
      if (!result.success) {
        throw NextlyError.internal({
          logContext: {
            reason: "first-admin-create-failed",
            detail: result.errorMessages?.[0],
          },
        });
      }
    },
    // No stored setup token to spend in this build.
    spendSetupToken: () => Promise.resolve(),
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

/** What the person is told for each outcome, and the exit code it carries. */
const OUTCOMES: Record<FirstAdminOutcome, { message: string; code: number }> = {
  created: { message: "Created the first administrator.", code: 0 },
  "administrator-exists": {
    message:
      "Setup is already complete: this install has an administrator. Nothing was created.",
    code: 1,
  },
  "email-in-use": {
    message:
      "An account already uses that email. Nothing was created; choose another email.",
    code: 1,
  },
  "setup-in-progress": {
    message:
      "Another setup is in progress for this install. Nothing was created; try again once it ends.",
    code: 1,
  },
};

/** The details, or the reason they cannot be had, as the line to print. */
async function gatherDetails(
  options: CreateAdminOptions,
  io: CreateAdminIo
): Promise<FirstAdminDetails | { problem: string }> {
  const email = await valueOf(options.email, "Email", io);
  if (email === null || !EmailSchema.safeParse(email).success) {
    return { problem: "Give a valid email with --email." };
  }
  const name = await valueOf(options.name, "Name", io);
  if (name === null)
    return { problem: "Give the administrator's name with --name." };
  const password = await readAdminPassword(io);
  if (password === undefined) return { problem: "The two passwords differ." };
  if (password === null) {
    return {
      problem: `Set ${ADMIN_PASSWORD_ENV}, or run this in a terminal to be asked. The password is never taken from an argument.`,
    };
  }
  return { email, name, password };
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
  if ("problem" in details) {
    logger.error(details.problem);
    return 1;
  }
  const strength = validatePasswordStrength(details.password);
  if (!strength.ok) {
    logger.error("That password is too weak:");
    for (const rule of strength.errors) logger.error(`  - ${rule}`);
    return 1;
  }
  const connection = await io.connect();
  try {
    const outcome = await createFirstAdministrator(connection.setup, details);
    const { message, code } = OUTCOMES[outcome];
    if (code === 0) logger.success(`${message} Sign in as ${details.email}.`);
    else logger.error(message);
    return code;
  } finally {
    await connection.close();
  }
}

/**
 * Connect to the database the install's environment names, with the system
 * tables registered so the account services can resolve them.
 */
async function connectToInstall(): Promise<{
  setup: FirstAdminSetup;
  close(): Promise<void>;
}> {
  const database = validateDatabaseEnv();
  if (!database.valid) {
    // The settings it names are the operator's own, so they are the message.
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      publicMessage: database.errors.join("; "),
    });
  }
  const cli = await createCliAdapter({
    dialect: database.dialect,
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
  return { setup: firstAdminSetupFor(adapter), close: () => cli.disconnect() };
}

/** The terminal and environment the command runs with. */
function processIo(): CreateAdminIo {
  const answer = (value: string | symbol): string | null =>
    p.isCancel(value) ? null : value;
  return {
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    askSecret: async message => answer(await p.password({ message })),
    ask: async message => answer(await p.text({ message })),
    connect: connectToInstall,
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
        process.exitCode = await runCreateAdmin(options, context, processIo());
      } catch (error) {
        context.logger.error(describeError(error));
        process.exitCode = 1;
      }
    });
}
