/**
 * Workflows' public surface carries no `@experimental` tag once the feature is complete.
 *
 * The surface is read from the source of every package it spans, by place:
 *
 * - the files that are workflows' alone (the core's workflows domain, its REST routes, its
 *   Direct API namespace, the stranded-stage CLI, and the admin's review client, types and
 *   editor surfaces), where any tag is one of workflows';
 * - the files workflows share with other features (the config surface, the collection and
 *   Single options, the route parser and dispatcher, the Direct API's namespaces and publish
 *   options, the public error data, the published filter keys), where a tag counts
 *   when its comment, or the declaration under it, is about a workflow or a review.
 *
 * Until the tags come off, the check is held as an expected failure (`it.fails`): it passes
 * while they are there, and fails the run the moment none is left, which is the signal to turn
 * it into a plain `it` in the same change that removes the last of them. The file count beside
 * it is a plain test throughout, so the scan can never pass by reading nothing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Paths whose every `@experimental` is workflows'. A directory is read whole. */
const WORKFLOW_ONLY = [
  "packages/nextly/src/domains/workflows",
  "packages/nextly/src/api/workflows.ts",
  "packages/nextly/src/direct-api/namespaces/workflows.ts",
  "packages/nextly/src/cli/commands/workflow-stranded.ts",
  "packages/nextly/src/cli/commands/workflow-stranded.command.ts",
  "packages/admin/src/services/workflowApi.ts",
  "packages/admin/src/types/workflows.ts",
  "packages/admin/src/hooks/queries/useReviewState.ts",
  "packages/admin/src/components/features/entries/review",
];

/** Files workflows share with other features: only a workflow's tag counts there. */
const SHARED = [
  "packages/nextly/src/config.ts",
  "packages/nextly/src/index.ts",
  "packages/nextly/src/collections/config/define-collection.ts",
  "packages/nextly/src/singles/config/types.ts",
  "packages/nextly/src/route-handler/route-parser.ts",
  "packages/nextly/src/direct-api/nextly.ts",
  "packages/nextly/src/direct-api/types/collections.ts",
  "packages/nextly/src/errors/public-data.ts",
  "packages/nextly/src/dispatcher/types.ts",
  "packages/nextly/src/init/nextly-instance.ts",
  // Published as `nextly/reserved-filter-keys`: its workflow filter keys are workflows' surface.
  "packages/nextly/src/domains/collections/query/reserved-filter-keys.ts",
];

/**
 * Left out of the scan on purpose, so a later edit cannot fold them in by accident: the plugin
 * workflow service (`ctx.services.workflows` and its plugin-sdk types) stays @experimental while
 * that work is paused, and a decision on it is pending.
 */
const EXCLUDED = [
  "packages/nextly/src/plugins/plugin-workflows.ts",
  "packages/plugin-sdk/src/index.ts",
];

/** What makes a shared file's tag a workflow's: its comment, or the line under it, says so. */
const ABOUT_WORKFLOWS = /workflow|without review|review state/i;

/** Source files, not tests: a test's own fixture text is no surface. */
function sourceFiles(path: string): string[] {
  const full = join(REPO, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { recursive: true, encoding: "utf8" })
    .map(entry => join(full, entry))
    .filter(
      file =>
        /\.(ts|tsx)$/.test(file) &&
        !/\.test(-d)?\.tsx?$/.test(file) &&
        !file.includes("__tests__")
    );
}

/**
 * Each `@experimental` in a file, as `path:line`, kept where `keep` says it counts: in a doc
 * comment, or in a line comment, as a union member or a route is marked.
 */
function tagsIn(
  file: string,
  keep: (comment: string, next: string) => boolean
): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(/\/\*\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
    const comment = match[0];
    if (!comment.includes("@experimental")) continue;
    const end = (match.index ?? 0) + comment.length;
    const next = source.slice(end).split("\n").slice(0, 2).join("\n");
    if (!keep(comment, next)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    found.push(`${relative(REPO, file)}:${line}`);
  }
  return found;
}

const workflowOnly = WORKFLOW_ONLY.flatMap(sourceFiles);
const shared = SHARED.flatMap(sourceFiles);

describe("workflows' public surface", () => {
  it("is read from the files that hold it", () => {
    // The workflows domain alone is dozens of files; a moved directory reads as none.
    expect(workflowOnly.length).toBeGreaterThan(30);
    expect(shared).toHaveLength(SHARED.length);
  });

  it("leaves the paused plugin workflow service out of the scan", () => {
    const scanned = [...workflowOnly, ...shared].map(file =>
      relative(REPO, file)
    );
    for (const path of EXCLUDED) expect(scanned).not.toContain(path);
  });

  it.fails("carries no @experimental tag", () => {
    const tags = [
      ...workflowOnly.flatMap(file => tagsIn(file, () => true)),
      ...shared.flatMap(file =>
        tagsIn(file, (comment, next) => ABOUT_WORKFLOWS.test(comment + next))
      ),
    ];
    expect(tags, `still @experimental:\n${tags.join("\n")}`).toEqual([]);
  });
});
