/**
 * Template Download via GitHub Codeload
 *
 * Downloads templates from the Nextly GitHub repo at runtime using the
 * Codeload API. Content templates are not bundled in the npm package; they
 * are fetched at the tag of this CLI's own release, so a template and the
 * Nextly packages the project declares come from one release. A --branch
 * takes the template from that branch instead.
 *
 * Fallback: --local-template flag reads from the filesystem (for development).
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "path";

import fs from "fs-extra";
import { x } from "tar";

import type { NextlySource } from "./nextly-release";

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
 * What to download: a branch the run named, or the release this CLI belongs
 * to, by its tag (`v<version>`), so the template comes from the same release
 * as the packages the project declares.
 */
export type TemplateRef = { branch: string } | { release: string };

/**
 * Download and extract a template from GitHub Codeload.
 *
 * Fetches the repo tarball and extracts only templates/base/ and
 * templates/{templateName}/ into a temporary directory. Returns
 * paths to both extracted directories.
 *
 * @param templateName - Template to download (e.g., "blog")
 * @param ref - The branch or the release to download it from
 */
export async function downloadTemplate(
  templateName: string,
  ref: TemplateRef = { branch: "main" }
): Promise<TemplateSource> {
  const name = "branch" in ref ? ref.branch : `v${ref.release}`;
  const url = `https://codeload.github.com/${GITHUB_ORG}/${GITHUB_REPO}/tar.gz/${name}`;

  // Create a temp directory for extraction
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `nextly-template-${Date.now()}`
  );
  await fs.ensureDir(tmpDir);

  // Every file of the archive sits under one top folder, which Codeload
  // names after the repository and the ref, though not as the ref is
  // spelled: a tag loses its `v` (`v0.0.2-alpha.66` gives
  // `nextly-0.0.2-alpha.66/`) and a branch's `/` becomes `-`. So files are
  // matched by their path below that folder, whatever it is called.
  const wanted = [`templates/base/`, `templates/${templateName}/`];
  const belowTop = (p: string): string => p.slice(p.indexOf("/") + 1);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(30000), // 30s timeout for download
      });
    } catch (error) {
      throw unreachable(templateName, error);
    }

    if (!response.ok) {
      throw new Error(
        response.status === 404 && "release" in ref
          ? `GitHub has no ${templateName} template for this create-nextly-app's release, ${ref.release} (no tag ${name}). ` +
            "To take the templates from a branch instead, run it again with --branch <name>, such as --branch main."
          : `Failed to download template from GitHub (${response.status}). ` +
            `URL: ${url}. ` +
            `Make sure the branch "${name}" exists and the repository is accessible.`
      );
    }

    if (!response.body) {
      throw new Error(
        `Empty response body when downloading template from GitHub. URL: ${url}`
      );
    }

    // Stream the tarball through tar extraction
    // Only extract files matching base or selected template paths
    try {
      await pipeline(
        Readable.from(response.body as unknown as NodeJS.ReadableStream),
        x({
          cwd: tmpDir,
          filter: (p: string) =>
            wanted.some(prefix => belowTop(p).startsWith(prefix)),
          // Strip the top folder so templates/ is at the root
          strip: 1,
        })
      );
    } catch (error) {
      // The connection can fail partway through the archive too.
      throw unreachable(templateName, error);
    }
  } catch (error) {
    // Clean up temp directory on failure
    await fs.remove(tmpDir).catch(() => {});
    throw error;
  }

  // Verify both directories were extracted
  const basePath = path.join(tmpDir, "templates", "base");
  const templatePath = path.join(tmpDir, "templates", templateName);

  if (!(await fs.pathExists(basePath))) {
    await fs.remove(tmpDir).catch(() => {});
    throw new Error(
      `Base template not found in downloaded archive. ` +
        `"${name}" may not contain templates.`
    );
  }

  if (!(await fs.pathExists(templatePath))) {
    await fs.remove(tmpDir).catch(() => {});
    throw new Error(
      `Template "${templateName}" not found in downloaded archive. ` +
        `Available templates may differ on "${name}".`
    );
  }

  return { basePath, templatePath };
}

/**
 * GitHub could not be reached, or stopped answering: a missing network, a
 * proxy or a timeout. Another ref would fail the same way, so the ways on are
 * to try again or to read the templates from disk.
 */
function unreachable(templateName: string, cause: unknown): Error {
  const reason =
    cause instanceof Error && cause.name === "TimeoutError"
      ? "it did not answer within 30 seconds"
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return new Error(
    `Could not reach GitHub to download the ${templateName} template: ${reason}. ` +
      "Try again, or run with --local-template <path> pointing at a copy of the templates.",
    { cause }
  );
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
 * 2. Otherwise: download from GitHub Codeload.
 *
 * Template source is independent of --use-yalc. --use-yalc only controls
 * how the scaffolded project's dependencies are installed (yalc store vs
 * npm registry); it does not force the template to be local. Use
 * --use-yalc alone to pair yalc-linked packages with the live GitHub
 * template; add --local-template only when you also want to test a
 * template change that's not yet pushed to the public repo.
 *
 * @param templateName - Template to resolve (e.g., "blog")
 * @param options - Resolution options
 */
export async function resolveTemplateSource(
  templateName: string,
  options: {
    localTemplatePath?: string;
    branch?: string;
    /**
     * Where the project's Nextly packages come from: with no branch named,
     * the template is downloaded at the same release.
     */
    source?: NextlySource;
  } = {}
): Promise<TemplateSource> {
  const { localTemplatePath, branch, source } = options;

  if (localTemplatePath) {
    return resolveLocalTemplate(localTemplatePath, templateName);
  }

  return downloadTemplate(
    templateName,
    branch !== undefined
      ? { branch }
      : source?.kind === "release"
        ? { release: source.cliVersion }
        : { branch: "main" }
  );
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
