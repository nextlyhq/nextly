import path from "path";

import fs from "fs-extra";

import type { ProjectType } from "../types";

// ============================================================
// Project Type Templates
// ============================================================

/**
 * Base templates for project types that use inline config generation.
 * Content templates (blog, etc.) use file-based configs from templates/configs/ instead.
 * Storage is not included - local disk is the default (zero config needed).
 */
const BASE_TEMPLATES: Record<
  string,
  { imports: string; collections: string; singles: string }
> = {
  blank: {
    imports: `import { defineConfig } from "@revnixhq/nextly/config";`,
    collections: `  // Add your collections here
  collections: [],`,
    singles: `  // Add your singles (globals) here
  singles: [],`,
  },
};

// ============================================================
// Template Builder
// ============================================================

/**
 * Build the complete nextly.config.ts content.
 */
function buildConfigTemplate(projectType: ProjectType): string {
  const base = BASE_TEMPLATES[projectType] || BASE_TEMPLATES["blank"];

  // Extract collection definitions (everything before "collections: [")
  const collectionsMatch = base.collections.match(
    /^([\s\S]*?)(\s*collections: \[[\s\S]*?\],?)$/
  );
  const collectionDefs = collectionsMatch ? collectionsMatch[1] : "";
  const collectionsLine = collectionsMatch
    ? collectionsMatch[2]
    : base.collections;

  // Extract singles definitions (everything before "singles: [")
  const singlesMatch = base.singles.match(
    /^([\s\S]*?)(\s*singles: \[[\s\S]*?\],?)$/
  );
  const singleDefs = singlesMatch ? singlesMatch[1] : "";
  const singlesLine = singlesMatch ? singlesMatch[2] : base.singles;

  // Build the template
  const template = `${base.imports}
${collectionDefs}${singleDefs}
export default defineConfig({
${collectionsLine}
${singlesLine}

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
`;

  return template;
}

// ============================================================
// Public API
// ============================================================

/**
 * Generate the nextly.config.ts file based on project type.
 * Storage is not configured here - local disk is the default in Nextly core.
 *
 * @param cwd - Working directory
 * @param projectType - Selected project type (blank, blog, etc.)
 */
export async function generateConfig(
  cwd: string,
  projectType: ProjectType
): Promise<void> {
  const configPath = path.join(cwd, "nextly.config.ts");

  // Check if config already exists
  if (await fs.pathExists(configPath)) {
    throw new Error(
      "nextly.config.ts already exists. Please remove it first or run in a fresh project."
    );
  }

  const template = buildConfigTemplate(projectType);
  await fs.writeFile(configPath, template, "utf-8");
}
