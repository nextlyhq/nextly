import { existsSync, statSync, readFileSync } from "fs";
import { resolve } from "path";

import * as baseSchemas from "../schemas/index";

/**
 * Load dynamic schemas from the directory where the command was executed
 */
function loadDynamicSchemasSync(): Record<string, unknown> {
  const dynamicSchemas: Record<string, unknown> = {};

  // Get the directory from where the pnpm command was originally run
  const rootDir = process.env.INIT_CWD || process.cwd();

  // Always look for src/db/schemas/dynamic/index.ts relative to that app
  const targetPath = resolve(rootDir, "src/db/schemas/dynamic/index.ts");

  if (!existsSync(targetPath)) {
    console.log(`ℹ️ No dynamic schema found at: ${targetPath}`);
    return dynamicSchemas;
  }

  try {
    if (statSync(targetPath).isFile()) {
      const content = readFileSync(targetPath, "utf8");

      const exportMatches = content.match(
        /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)|export\s*\{\s*([^}]+)\s*\}/g
      );

      if (exportMatches) {
        const exports = exportMatches
          .map((m: string) => {
            const constMatch = m.match(
              /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/
            );
            const namedMatch = m.match(/export\s*\{\s*([^}]+)\s*\}/);
            if (constMatch) return constMatch[1];
            if (namedMatch)
              return namedMatch[1]
                .split(",")
                .map(s => s.trim())
                .join(", ");
            return "";
          })
          .filter(Boolean)
          .join(", ");
        console.log(`✅ Found dynamic schema exports: ${exports}`);
      }

      const loadedSchemas = require(targetPath);
      Object.assign(dynamicSchemas, loadedSchemas);
      console.log(
        `✅ Successfully loaded ${Object.keys(loadedSchemas).length} dynamic schemas from ${targetPath}`
      );
    }
  } catch (error) {
    console.warn("⚠️ Failed to load dynamic schemas:", error);
  }

  return dynamicSchemas;
}

/**
 * Merge base and dynamic schemas
 */
export function createMergedSchemas() {
  const baseSchemasObj = baseSchemas;
  const dynamicSchemas = loadDynamicSchemasSync();

  const mergedSchemas = {
    ...baseSchemasObj,
    ...dynamicSchemas,
  };

  console.log(
    `📦 Merged ${Object.keys(baseSchemasObj).length} base schemas + ${Object.keys(dynamicSchemas).length} dynamic schemas`
  );

  return mergedSchemas;
}

export const mergedSchemas = createMergedSchemas();
