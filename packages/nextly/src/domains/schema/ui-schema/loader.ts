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

import { restorePluginFieldOptions } from "./preserve-plugin-options";

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

/** A manifest as one read found it, and whether the file was there to read. */
export interface ReadUiSchema {
  manifest: UiSchemaManifest;
  /** False where the file is absent, and `manifest` is the empty one standing in for it. */
  exists: boolean;
}

/** The manifest alone, for a caller that does not ask whether the file exists. */
export async function loadUiSchema(
  args: LoadUiSchemaArgs
): Promise<UiSchemaManifest> {
  return (await readUiSchema(args)).manifest;
}

/**
 * The manifest and whether its file exists, from one read. An empty manifest and an absent file
 * parse alike, so a caller that treats them differently asks here rather than check the file a
 * second time, which could see it in another state.
 */
export async function readUiSchema(
  args: LoadUiSchemaArgs
): Promise<ReadUiSchema> {
  const path = resolve(args.projectRoot, args.uiSchemaFile);

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return { manifest: emptyManifest(), exists: false };
    }
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
  // Restored on the way in as well as on the way out. The parse strips a plugin
  // field type's options, so a manifest loaded without this would hand every
  // later write a declaration already missing them — and rewriting the file for
  // one entity would quietly drop the options of all the others.
  return {
    manifest: restorePluginFieldOptions(result.data, json),
    exists: true,
  };
}
