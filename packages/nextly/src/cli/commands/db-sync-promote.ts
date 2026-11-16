// What: implements `nextly db:sync --promote <slug>` which moves a UI-owned
// collection (stored in dynamic_collections) to code-owned by printing a
// TS snippet the user pastes into nextly.config.ts, then removing the UI
// record.
// blessed escape hatch for users who built a collection in the UI and then
// want to version-control its schema alongside their code.

import { appendFileSync, existsSync } from "node:fs";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { assertNoMigrationInFlight } from "../../domains/field-groups/migration/sync-guard";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { planChangedAfterConsent } from "../../domains/schema/migrate/plan-changed-after-consent";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { reportDryRun, type DryRunChange, type DryRunPlan } from "../dry-run";
import { exitWithError } from "../errors";
import {
  promoteCollectionNotFound,
  syncConfirmationRequired,
} from "../errors/areas/sync";
import type { CommandContext } from "../program";
import type { Logger } from "../utils/logger";
import { answered } from "../utils/prompt-cancelled";

import {
  droppedHooksNote,
  droppedPreviewNote,
  promotedCollection,
} from "./db-sync-promote-collection";
import {
  storedTemplateAddress,
  templateAddressNote,
} from "./db-sync-promote-template-address";
import {
  collectionChangedAfterConsent,
  openCollectionRegistry,
  sameCollectionRecord,
  syncRefusalOf,
  withCollectionRegistryWrite,
} from "./db-sync-registry";

/**
 * Whether `db:sync --yes` was given, answering the confirmation of
 * `--promote` and `--demote` (neither is a data-loss consent). It arrives
 * with the run's options, which the command's context carries.
 */
export function confirmationAnswered(context: CommandContext): boolean {
  const options: Record<string, unknown> = { ...context.options };
  return options.yes === true;
}

/** What a promote acts on, with its prompt and its lock wait as seams a test can stand in for. */
export interface PromoteCollectionArgs {
  slug: string;
  logger: Logger;
  /** Where `nextly.config.ts` is looked for. */
  cwd: string;
  registry: CollectionRegistryService;
  /** The adapter the registry was opened on; the schema lock is taken on it. */
  adapter: DrizzleAdapter;
  /** Shows the generated code and answers whether to go ahead. Runs holding no lock. */
  confirm: (code: string) => Promise<boolean>;
  /** How long a held schema lock is waited for, in milliseconds. */
  lockWaitMs?: number;
  /**
   * The template address the collection's entries are served at, stored on its page builder
   * template, or null for none. Absent, none is read.
   */
  templateAddress?: (slug: string) => Promise<string | null>;
}

/**
 * What a promote of one collection changes, read before anything is asked or written: the record
 * whose row it removes, the code it appends, and the configuration file it appends to.
 */
interface PromotionPlan {
  slug: string;
  /** The registry record the code is generated from, and whose row is removed. */
  record: DynamicCollectionRecord;
  /** The collection as `nextly.config.ts` source. */
  code: string;
  /** The template address read before the prompt, or null for none; read again under the lock. */
  address: string | null;
  /** What the promote cannot carry into code (a template address, hooks, a preview), shown and appended beside it. */
  note: string[];
  /** The code with its note, as the confirmation shows it and a run without a config prints it. */
  preview: string;
  /** The configuration file the snippet is appended to; null when none is found, and it is printed. */
  configPath: string | null;
}

/**
 * The plan of a promote of `slug`, from the registry as it stands. A slug the Schema Builder has no
 * collection under is refused.
 */
async function planPromotion(
  slug: string,
  registry: CollectionRegistryService,
  cwd: string,
  templateAddress?: (slug: string) => Promise<string | null>
): Promise<PromotionPlan> {
  const record = await registry.getCollectionBySlug(slug);
  if (!record) throw promoteCollectionNotFound(slug);
  const code = serializeCollection(promotedCollection(record));
  // A collection whose template stores an address keeps its entries there only if the address is
  // declared in code too, so the declaration is shown and appended beside its code.
  const address = (await templateAddress?.(slug)) ?? null;
  const note = [
    ...(address === null ? [] : templateAddressNote(slug, address)),
    ...droppedHooksNote(record.hooks),
    ...droppedPreviewNote(record.admin),
  ];
  return {
    slug,
    record,
    code,
    address,
    note,
    preview: [code, ...note.map(line => `// ${line}`)].join("\n"),
    configPath: findConfigFile(cwd),
  };
}

/**
 * The commented snippet a promote appends, stamped with `at`. Commented because the collections
 * array is not AST-edited: users may have custom imports, env-gated branches, or other machinery
 * the AST transformer cannot safely preserve.
 */
function promotionSnippet(plan: PromotionPlan, at: Date): string {
  return [
    "",
    `// Promoted from UI source on ${at.toISOString()}.`,
    "// Move this entry into your collections array:",
    ...plan.code.split("\n").map(line => `// ${line}`),
    ...plan.note.map(line => `// ${line}`),
    "",
  ].join("\n");
}

/**
 * Carry out `plan`: append the snippet to the configuration (or print it where there is none),
 * then remove the registry row. The deletion's own refusal, such as a record defined in code, is
 * asked first, so a refused promote leaves the configuration as it was.
 *
 * The configuration file is looked up again here, under the lock, because the one found before the
 * prompt may have been moved or deleted while it was open: appending at that path would create a
 * file holding only the snippet, which the loader then prefers over the moved configuration. A
 * file that is no longer where it was confirmed stops the run with nothing written.
 */
async function applyPromotion(
  plan: PromotionPlan,
  registry: CollectionRegistryService,
  logger: Logger,
  cwd: string,
  templateAddress?: (slug: string) => Promise<string | null>
): Promise<void> {
  await registry.assertDeletable(plan.slug);

  const configPath = findConfigFile(cwd);
  if (configPath !== plan.configPath) {
    throw planChangedAfterConsent({
      command: "nextly db:sync --promote",
      message: `The configuration file changed after you confirmed (${plan.configPath ?? "none found"} is now ${configPath ?? "missing"}); nothing was changed; run the command again`,
      agreed: [plan.configPath ?? "no configuration file: the snippet printed"],
      current: [configPath ?? "no configuration file"],
    });
  }

  // The address the printed declaration names, read again too: one changed in the admin since the
  // preview would be declared stale, and the collection moved back to it at the next start.
  const addressNow = (await templateAddress?.(plan.slug)) ?? null;
  if (addressNow !== plan.address) {
    throw planChangedAfterConsent({
      command: "nextly db:sync --promote",
      message: `${plan.slug}'s template address changed after you confirmed; nothing was changed; run the command again`,
      agreed: plan.address === null ? [] : [plan.address],
      current: addressNow === null ? [] : [addressNow],
    });
  }

  if (!plan.configPath) {
    logger.warn(
      "Could not locate nextly.config.ts. The snippet is printed below; paste it into the collections array manually."
    );
    logger.info(plan.preview);
  } else {
    appendFileSync(plan.configPath, promotionSnippet(plan, new Date()));
    logger.info(`Appended commented snippet to ${plan.configPath}.`);
  }

  // Delete the UI record so there is no collision on next wrapper start. `deleteCollection`
  // removes the registry row ONLY — it deliberately leaves the data table (and its `_locales`
  // companion) in place, because promotion hands the same table over to the code-first
  // definition. Dropping here would destroy the collection's content.
  await registry.deleteCollection(plan.slug);
}

/**
 * Promote one Schema Builder collection: append its code as a commented snippet to the config,
 * then remove its registry row.
 *
 * The operator is asked first, holding no lock, so a confirmation left open blocks nothing. The
 * write then takes the schema lock and reads the record again: if it changed or vanished since the
 * preview, nothing is written and the run stops with `PLAN_CHANGED_AFTER_CONSENT`.
 */
export async function promoteCollection(
  args: PromoteCollectionArgs
): Promise<"promoted" | "cancelled"> {
  const { slug, logger, registry } = args;

  const plan = await planPromotion(
    slug,
    registry,
    args.cwd,
    args.templateAddress
  );

  if (!(await args.confirm(plan.preview))) {
    logger.info("Promote cancelled.");
    return "cancelled";
  }

  await withCollectionRegistryWrite(
    {
      adapter: args.adapter,
      logger,
      label: "db:sync --promote",
      waitMs: args.lockWaitMs,
    },
    async () => {
      // Read again under the lock: the snippet and the deletion must act on the record the
      // operator confirmed, not on one another process wrote since.
      const current = await registry.getCollectionBySlug(slug);
      if (!sameCollectionRecord(plan.record, current)) {
        throw collectionChangedAfterConsent({
          slug,
          command: "nextly db:sync --promote",
          confirmed: plan.record,
          current,
        });
      }
      await applyPromotion(
        plan,
        registry,
        logger,
        args.cwd,
        args.templateAddress
      );
    }
  );

  logger.info(
    `Collection '${slug}' removed from UI source. Move the snippet into your collections array, then restart dev server.`
  );
  if (plan.note.length > 0) logger.info(plan.note.join("\n"));
  return "promoted";
}

/**
 * What `db:sync --promote <slug> --dry-run` reports: the plan the real promote carries out, with
 * the refusals it asks along the way, in its order (no collection, a field-group storage migration
 * in flight, a deletion the registry refuses), and nothing asked, locked or written.
 */
async function previewPromotion(args: {
  slug: string;
  cwd: string;
  registry: CollectionRegistryService;
  adapter: DrizzleAdapter;
  logger: Logger;
  templateAddress?: (slug: string) => Promise<string | null>;
}): Promise<DryRunPlan> {
  try {
    const plan = await planPromotion(
      args.slug,
      args.registry,
      args.cwd,
      args.templateAddress
    );
    await assertNoMigrationInFlight({
      adapter: args.adapter,
      logger: args.logger,
      action: "db:sync --promote",
    });
    await args.registry.assertDeletable(args.slug);
    return promotionDryRun(plan, new Date());
  } catch (error) {
    const refusal = syncRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes: [], refusals: [refusal] };
  }
}

/** `plan` as a dry run names it: the snippet and where it goes, then the registry row removed. */
function promotionDryRun(plan: PromotionPlan, at: Date): DryRunPlan {
  const changes: DryRunChange[] = [];
  const notes: string[] = [];
  if (plan.configPath) {
    changes.push({
      action: "edit",
      target: `${plan.configPath}, appending this commented snippet:${promotionSnippet(plan, at).trimEnd()}`,
    });
  } else {
    notes.push(
      `No nextly.config.ts was found, so a real run prints this code to paste instead of appending it:\n${plan.preview}`
    );
  }
  changes.push({
    action: "remove",
    target: `the registry row of collection '${plan.slug}' (its table ${plan.record.tableName} and its rows are kept)`,
  });
  return { changes, notes };
}

/** The terminal's confirmation for a promote: a preview on request, then a yes or no. */
async function askToPromote(slug: string, code: string): Promise<boolean> {
  // Ctrl+C at either prompt ends the run with exit 130 (`answered`); choosing Cancel, or a no,
  // is a declined promote.
  const action = await answered(
    await p.select({
      message: `Preview generated code for '${slug}'. Action?`,
      options: [
        { value: "preview", label: "Show preview" },
        { value: "accept", label: "Append to nextly.config.ts" },
        { value: "decline", label: "Cancel" },
      ],
    })
  );
  if (action === "decline") return false;
  if (action === "preview") {
    p.note(code, "Generated code");
    const confirm = await answered(
      await p.confirm({
        message: "Append this to nextly.config.ts and delete the UI record?",
      })
    );
    if (!confirm) return false;
  }
  return true;
}

export async function runPromote(
  slug: string,
  context: CommandContext
): Promise<void> {
  // Its confirmation cannot be asked and `--yes` did not answer it: stop before the database is
  // opened, so nothing is changed.
  if (!confirmationAnswered(context) && !canPrompt()) {
    exitWithError(context.logger, syncConfirmationRequired("--promote", slug));
  }

  // Database wiring, shared with --demote, so a missing or unreachable database ends with the
  // same errors as the rest of db:sync.
  const opened = await openCollectionRegistry(context.logger);
  if (opened === undefined) return;
  const { registry, adapter } = opened;
  try {
    await promoteCollection({
      slug,
      logger: context.logger,
      cwd: context.cwd,
      registry,
      adapter,
      templateAddress: collection =>
        storedTemplateAddress(
          {
            getAllCollections: () => registry.getAllCollections(),
            queryStatement: statement => adapter.queryStatement(statement),
          },
          collection
        ),
      // `--yes` answers the confirmation: append, without asking.
      confirm: code =>
        confirmationAnswered(context)
          ? Promise.resolve(true)
          : askToPromote(slug, code),
    });
  } finally {
    await adapter.disconnect();
  }
}

/**
 * `db:sync --promote <slug> --dry-run`: the promote's plan, read over a read-only connection,
 * with no confirmation asked and no lock taken. A database that is not there has been said and
 * ends the run.
 */
export async function runPromoteDryRun(
  slug: string,
  context: CommandContext
): Promise<void> {
  const opened = await openCollectionRegistry(context.logger, true);
  if (opened === undefined) return;
  try {
    reportDryRun(
      context.logger,
      await previewPromotion({
        slug,
        cwd: context.cwd,
        registry: opened.registry,
        adapter: opened.adapter,
        logger: context.logger,
        // The same address a real promote reads, over the read-only connection.
        templateAddress: collection =>
          storedTemplateAddress(
            {
              getAllCollections: () => opened.registry.getAllCollections(),
              queryStatement: statement =>
                opened.adapter.queryStatement(statement),
            },
            collection
          ),
      })
    );
  } finally {
    await opened.adapter.disconnect();
  }
}

// Minimal config file locator. Matches the loader's search order but we
// only need the path here, not the parsed config - keeps this command
// isolated from jiti.
function findConfigFile(cwd: string): string | null {
  const candidates = [
    "nextly.config.ts",
    "nextly.config.js",
    "nextly.config.mjs",
    "src/nextly.config.ts",
    "src/nextly.config.js",
  ];
  for (const candidate of candidates) {
    const full = `${cwd}/${candidate}`;
    if (existsSync(full)) return full;
  }
  return null;
}
