// What: implements `nextly db:sync --promote <slug>` which moves a UI-owned
// collection (stored in dynamic_collections) to code-owned by printing a
// TS snippet the user pastes into nextly.config.ts, then removing the UI
// record.
// Why: Task 11 enforces exclusive source ownership. This command is the
// blessed escape hatch for users who built a collection in the UI and then
// want to version-control its schema alongside their code.

import { appendFileSync, existsSync } from "node:fs";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { serializeCollection } from "../../domains/schema/services/code-generator";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import type { CommandContext } from "../program";
import { createAdapter, validateDatabaseEnv } from "../utils/adapter";

export async function runPromote(
  slug: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // 1. Database wiring. Reuses the same validateDatabaseEnv + createAdapter
  // pipeline as the normal db:sync flow so DATABASE_URL errors look the
  // same as always.
  const env = validateDatabaseEnv();
  if (!env.valid) {
    logger.error(env.errors.join("; "));
    process.exit(1);
  }
  const adapter = await createAdapter({ logger });

  // CollectionRegistryService expects a full DrizzleAdapter. The CLI
  // adapter is structurally compatible; same cast pattern as dev-build.ts.
  const registry = new CollectionRegistryService(
    adapter as unknown as DrizzleAdapter,
    {
      info: (msg: string) => logger.debug(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
      debug: (msg: string) => logger.debug(msg),
    }
  );

  // 2. Fetch the UI collection record.
  const record = await registry.getCollectionBySlug(slug);
  if (!record) {
    logger.error(
      `Collection '${slug}' not found in UI source (dynamic_collections).`
    );
    process.exit(1);
  }

  // 3. Serialize the record's fields to idiomatic TS source.
  const fields = (record.fields ?? []) as unknown[];
  const code = serializeCollection({ slug, fields: fields as never[] });

  // 4. User confirmation flow.
  const action = await p.select({
    message: `Preview generated code for '${slug}'. Action?`,
    options: [
      { value: "preview", label: "Show preview" },
      { value: "accept", label: "Append to nextly.config.ts" },
      { value: "decline", label: "Cancel" },
    ],
  });

  if (p.isCancel(action) || action === "decline") {
    logger.info("Promote cancelled.");
    return;
  }

  if (action === "preview") {
    p.note(code, "Generated code");
    const confirm = await p.confirm({
      message: "Append this to nextly.config.ts and delete the UI record?",
    });
    if (p.isCancel(confirm) || !confirm) {
      logger.info("Promote cancelled.");
      return;
    }
  }

  // 5. Append to config file as a COMMENTED snippet. We do not try to AST-
  // edit the collections array because users may have custom imports,
  // env-gated branches, or other machinery the AST transformer cannot
  // safely preserve. A future iteration can add --write-inline once the
  // AST editor is robust.
  const configPath = findConfigFile(context.cwd);
  if (!configPath) {
    logger.warn(
      "Could not locate nextly.config.ts. The snippet is printed below; paste it into the collections array manually."
    );
    logger.info(code);
  } else {
    const snippet = [
      "",
      `// Promoted from UI source on ${new Date().toISOString()}.`,
      "// Move this entry into your collections array:",
      ...code.split("\n").map(line => `// ${line}`),
      "",
    ].join("\n");
    appendFileSync(configPath, snippet);
    logger.info(`Appended commented snippet to ${configPath}.`);
  }

  // 6. Delete the UI record so there is no collision on next wrapper start.
  // We do this via the registry's deleteCollection (which also cleans up
  // permissions, data tables, etc. per existing logic).
  await registry.deleteCollection(slug);

  logger.info(
    `Collection '${slug}' removed from UI source. Move the snippet into your collections array, then restart dev server.`
  );
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
