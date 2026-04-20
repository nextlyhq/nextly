/**
 * Template Download via GitHub Codeload
 *
 * Downloads templates from the Nextly GitHub repo at runtime using the
 * Codeload API. This follows the same pattern as Payload CMS's
 * create-payload-app. Templates are NOT bundled in the npm package -
 * they're fetched on demand so template updates don't require a CLI release.
 *
 * Fallback: --local-template flag reads from the filesystem (for development).
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "path";

import fs from "fs-extra";
import { x } from "tar";

// GitHub repository coordinates for the Nextly monorepo
const GITHUB_ORG = "nextlyhq";
const GITHUB_REPO = "nextly";

/**
 * Resolved template source paths after download or local resolution.
 * basePath points to the base template directory.
 * templatePath points to the selected template directory (e.g., blog/).
 */
export interface TemplateSource {
  basePath: string;
  templatePath: string;
}

/**
 * Download and extract a template from GitHub Codeload.
 *
 * Fetches the repo tarball and extracts only templates/base/ and
 * templates/{templateName}/ into a temporary directory. Returns
 * paths to both extracted directories.
 *
 * @param templateName - Template to download (e.g., "blog")
 * @param branch - Git branch to download from (defaults to "main")
 */
export async function downloadTemplate(
  templateName: string,
  branch: string = "main"
): Promise<TemplateSource> {
  const url = `https://codeload.github.com/${GITHUB_ORG}/${GITHUB_REPO}/tar.gz/${branch}`;

  // Create a temp directory for extraction
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `nextly-template-${Date.now()}`
  );
  await fs.ensureDir(tmpDir);

  // The tarball contains files prefixed with "{repo}-{branch}/"
  // We need to extract templates/base/ and templates/{templateName}/
  const repoPrefix = `${GITHUB_REPO}-${branch}`;
  const baseFilter = `${repoPrefix}/templates/base/`;
  const templateFilter = `${repoPrefix}/templates/${templateName}/`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000), // 30s timeout for download
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download template from GitHub (${response.status}). ` +
          `URL: ${url}. ` +
          `Make sure the branch "${branch}" exists and the repository is accessible.`
      );
    }

    if (!response.body) {
      throw new Error(
        `Empty response body when downloading template from GitHub. URL: ${url}`
      );
    }

    // Stream the tarball through tar extraction
    // Only extract files matching base or selected template paths
    await pipeline(
      Readable.from(response.body as unknown as NodeJS.ReadableStream),
      x({
        cwd: tmpDir,
        filter: (p: string) =>
          p.startsWith(baseFilter) || p.startsWith(templateFilter),
        // Strip the "{repo}-{branch}/" prefix so templates/ is at the root
        strip: 1,
      })
    );
  } catch (error) {
    // Clean up temp directory on failure
    await fs.remove(tmpDir).catch(() => {});

    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "Template download timed out after 30 seconds. " +
          "Check your internet connection or use --local-template for offline development."
      );
    }

    throw error;
  }

  // Verify both directories were extracted
  const basePath = path.join(tmpDir, "templates", "base");
  const templatePath = path.join(tmpDir, "templates", templateName);

  if (!(await fs.pathExists(basePath))) {
    await fs.remove(tmpDir).catch(() => {});
    throw new Error(
      `Base template not found in downloaded archive. ` +
        `The branch "${branch}" may not contain templates.`
    );
  }

  if (!(await fs.pathExists(templatePath))) {
    await fs.remove(tmpDir).catch(() => {});
    throw new Error(
      `Template "${templateName}" not found in downloaded archive. ` +
        `Available templates may differ on branch "${branch}".`
    );
  }

  return { basePath, templatePath };
}

/**
 * Resolve template source from a local filesystem path.
 *
 * Used with --local-template flag during development. Reads templates
 * from the monorepo root's /templates/ directory without downloading.
 *
 * @param localPath - Path to the local templates/ directory
 * @param templateName - Template to use (e.g., "blog")
 */
export async function resolveLocalTemplate(
  localPath: string,
  templateName: string
): Promise<TemplateSource> {
  const basePath = path.join(localPath, "base");
  const templatePath = path.join(localPath, templateName);

  if (!(await fs.pathExists(basePath))) {
    throw new Error(
      `Base template not found at ${basePath}. ` +
        `Check the --local-template path points to the templates/ directory.`
    );
  }

  if (!(await fs.pathExists(templatePath))) {
    throw new Error(
      `Template "${templateName}" not found at ${templatePath}. ` +
        `Check the --local-template path points to the templates/ directory.`
    );
  }

  return { basePath, templatePath };
}

/**
 * Resolve template source - either from local filesystem or GitHub.
 *
 * Decision logic:
 * 1. If --local-template is provided: read from filesystem (dev / yalc).
 * 2. If useYalc is true without --local-template: refuse with a clear
 *    error. Pre-alpha there is no public GitHub repo to download from,
 *    and shipping the ~500KB templates dir inside the CLI package bloats
 *    every install. Callers must pass --local-template alongside
 *    --use-yalc while working against the monorepo.
 * 3. Otherwise: download from GitHub Codeload (production npm install).
 *
 * @param templateName - Template to resolve (e.g., "blog")
 * @param options - Resolution options
 */
export async function resolveTemplateSource(
  templateName: string,
  options: {
    localTemplatePath?: string;
    branch?: string;
    useYalc?: boolean;
  } = {}
): Promise<TemplateSource> {
  const { localTemplatePath, branch = "main", useYalc = false } = options;

  if (localTemplatePath) {
    return resolveLocalTemplate(localTemplatePath, templateName);
  }

  if (useYalc) {
    throw new Error(
      `--use-yalc requires --local-template <path-to-nextly-dev/templates> ` +
        `because templates are not bundled in the published CLI. Example:\n` +
        `  npx create-nextly-app my-app --use-yalc \\\n` +
        `    --local-template /path/to/nextly-dev/templates \\\n` +
        `    --template blog\n` +
        `Once the public template repo is published, you can omit both ` +
        `flags and templates will be downloaded from GitHub.`
    );
  }

  return downloadTemplate(templateName, branch);
}

/**
 * Clean up temporary download directory if it exists.
 * Safe to call with any path - only removes directories under TMPDIR.
 */
export async function cleanupDownload(source: TemplateSource): Promise<void> {
  const tmpBase = process.env.TMPDIR || "/tmp";

  // Only clean up if the paths are in the temp directory
  // (don't delete local template paths from --local-template)
  if (source.basePath.startsWith(tmpBase)) {
    // Go up to the extraction root (parent of "templates/")
    const extractionRoot = path.resolve(source.basePath, "../..");
    await fs.remove(extractionRoot).catch(() => {});
  }
}
