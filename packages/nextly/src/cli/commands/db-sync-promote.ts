// What: implements `nextly db:sync --promote <slug>` which moves a UI-owned
// collection (stored in dynamic_collections) to code-owned by printing a
// TS snippet the user pastes into nextly.config.ts, then removing the UI
// record.
// blessed escape hatch for users who built a collection in the UI and then
// want to version-control its schema alongside their code.

import { appendFileSync, existsSync } from "node:fs";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { planChangedAfterConsent } from "../../domains/schema/migrate/plan-changed-after-consent";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { exitWithError } from "../errors";
import {
  promoteCollectionNotFound,
  syncConfirmationRequired,
} from "../errors/areas/sync";
import type { CommandContext } from "../program";
import type { Logger } from "../utils/logger";
import { answered } from "../utils/prompt-cancelled";

import {
  collectionChangedAfterConsent,
  openCollectionRegistry,
  sameCollectionRecord,
  withCollectionRegistryWrite,
} from "./db-sync-registry";
import {
  storedTemplateAddress,
  templateAddressNote,
} from "./db-sync-promote-template-address";

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

  const confirmed = await registry.getCollectionBySlug(slug);
  if (!confirmed) throw promoteCollectionNotFound(slug);

  const fields = (confirmed.fields ?? []) as unknown[];
  const code = serializeCollection({ slug, fields: fields as never[] });
  // A collection whose template stores an address keeps its entries there only if the address is
  // declared in code too, so the declaration is shown and appended beside its code.
  const address = (await args.templateAddress?.(slug)) ?? null;
  const note = address === null ? [] : templateAddressNote(slug, address);
  const preview = [code, ...note.map(line => `// ${line}`)].join("\n");

  if (!(await args.confirm(preview))) {
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
      if (!sameCollectionRecord(confirmed, current)) {
        throw collectionChangedAfterConsent({
          slug,
          command: "nextly db:sync --promote",
          confirmed,
          current,
        });
      }
      // The address the printed declaration names, read again too: one
      // changed in the admin since the preview would be declared stale, and
      // the collection moved back to it at the next start.
      const addressNow = (await args.templateAddress?.(slug)) ?? null;
      if (addressNow !== address) {
        throw planChangedAfterConsent({
          command: "nextly db:sync --promote",
          message: `${slug}'s template address changed after you confirmed; nothing was changed; run the command again`,
          agreed: address === null ? [] : [address],
          current: addressNow === null ? [] : [addressNow],
        });
      }

      // Append to config file as a COMMENTED snippet. We do not try to AST-edit the collections
      // array because users may have custom imports, env-gated branches, or other machinery the
      // AST transformer cannot safely preserve.
      const configPath = findConfigFile(args.cwd);
      if (!configPath) {
        logger.warn(
          "Could not locate nextly.config.ts. The snippet is printed below; paste it into the collections array manually."
        );
        logger.info(preview);
      } else {
        const snippet = [
          "",
          `// Promoted from UI source on ${new Date().toISOString()}.`,
          "// Move this entry into your collections array:",
          ...code.split("\n").map(line => `// ${line}`),
          ...note.map(line => `// ${line}`),
          "",
        ].join("\n");
        appendFileSync(configPath, snippet);
        logger.info(`Appended commented snippet to ${configPath}.`);
      }

      // Delete the UI record so there is no collision on next wrapper start. `deleteCollection`
      // removes the registry row ONLY — it deliberately leaves the data table (and its `_locales`
      // companion) in place, because promotion hands the same table over to the code-first
      // definition. Dropping here would destroy the collection's content.
      await registry.deleteCollection(slug);
    }
  );

  logger.info(
    `Collection '${slug}' removed from UI source. Move the snippet into your collections array, then restart dev server.`
  );
  if (note.length > 0) logger.info(note.join("\n"));
  return "promoted";
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
  const { registry, adapter } = await openCollectionRegistry(context.logger);
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
