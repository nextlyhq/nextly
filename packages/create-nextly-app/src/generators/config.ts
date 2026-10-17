import type { ProjectInfo, ProjectType } from "../types";

import type { GeneratedFiles } from "./generated-files";
import { typesOutputFile } from "./types";
import { nothingYet, writeNew } from "./write-new";

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
    imports: `import { defineConfig } from "nextly/config";`,
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
function buildConfigTemplate(
  projectType: ProjectType,
  typesFile: string
): string {
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
    outputFile: "${typesFile}",
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
 * @param projectInfo - The detected project, whose layout places the types file
 */
export async function generateConfig(
  cwd: string,
  projectType: ProjectType,
  projectInfo: ProjectInfo
): Promise<GeneratedFiles> {
  const files = nothingYet();
  // A config the app already has is its own, from an earlier run or written
  // by hand: it is kept, and Nextly uses it.
  await writeNew(
    cwd,
    "nextly.config.ts",
    buildConfigTemplate(projectType, typesOutputFile(projectInfo)),
    files,
    { why: "the app already has one, and Nextly uses it as it is" }
  );
  return files;
}
