/**
 * `ui-schema.json` reader/loader (spec §4.12.2 Layer 3).
 *
 * Resolves the manifest path from `db.uiSchemaFile` (default `./ui-schema.json`)
 * relative to the project root, reads + validates it via the shared Zod schema,
 * and returns the parsed manifest. An absent file is an empty manifest (no
 * UI-built entities). Any read/parse/validation failure throws
 * NEXTLY_UI_SCHEMA_INVALID — no partial application.
 *
 * @module domains/schema/ui-schema/loader
 * @since v0.0.3-alpha (Plan D1)
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors";
import {
  parseUiSchema,
  uiSchemaManifest,
  type UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";

export interface LoadUiSchemaArgs {
  /** Project root (where `nextly.config.ts` lives). */
  projectRoot: string;
  /** `db.uiSchemaFile` value (relative to projectRoot). */
  uiSchemaFile: string;
}

/** The canonical empty manifest (file absent). */
function emptyManifest(): UiSchemaManifest {
  return uiSchemaManifest.parse({});
}

export async function loadUiSchema(
  args: LoadUiSchemaArgs
): Promise<UiSchemaManifest> {
  const path = resolve(args.projectRoot, args.uiSchemaFile);

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return emptyManifest();
    throw new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `Failed to read ui-schema file at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `ui-schema.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const result = parseUiSchema(json);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new NextlyError({
      code: "NEXTLY_UI_SCHEMA_INVALID",
      publicMessage: `ui-schema.json failed validation: ${issues}`,
    });
  }
  return result.data;
}
