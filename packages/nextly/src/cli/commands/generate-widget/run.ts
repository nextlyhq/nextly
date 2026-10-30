/**
 * What `generate:widget` does, apart from reading its flags and printing: find
 * the target, settle the id, view and setting (asking on a terminal for what
 * the flags left out), build every file and registration edit, and write them
 * unless a file is already there or it was asked only to show them.
 *
 * Nothing is written until everything that would be is known and checked, so
 * a refusal leaves the project exactly as it was.
 *
 * @module cli/commands/generate-widget/run
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  adminExportEdit,
  registrationEdit,
  type FileEdit,
} from "./config-edit";
import {
  componentRef,
  componentSource,
  declarationSource,
  camelCase,
  isWidgetViewKind,
  testSource,
  WIDGET_VIEW_KINDS,
  type WidgetPlan,
  type WidgetViewKind,
} from "./files";
import { widgetId } from "./id";
import { findTarget, planPaths, type TargetChoice } from "./target";

/** What the command asks on a terminal when a flag left something out. */
export interface WidgetPrompter {
  id(): Promise<string>;
  view(kinds: readonly WidgetViewKind[]): Promise<WidgetViewKind>;
  collection(): Promise<boolean>;
}

export interface GenerateWidgetOptions {
  id?: string;
  view?: string;
  collection?: boolean;
  target?: TargetChoice;
  force?: boolean;
  dryRun?: boolean;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export type GenerateWidgetResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      written: boolean;
      files: GeneratedFile[];
      edits: FileEdit[];
      /** Registrations it could not make safely, for the author to make. */
      manual: string[];
      nextSteps: string[];
    };

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  );

/** The first of `candidates` that exists. */
async function firstExisting(
  candidates: string[]
): Promise<string | undefined> {
  for (const path of candidates) if (await exists(path)) return path;
  return undefined;
}

type Settled =
  | { ok: true; id: string; view: WidgetViewKind; collection: boolean }
  | { ok: false; reason: string };

/** The id, view and setting: from the flags, else asked, else the defaults. */
async function settle(
  options: GenerateWidgetOptions,
  prompter: WidgetPrompter | undefined
): Promise<Settled> {
  const id = options.id ?? (await prompter?.id());
  if (!id) {
    return {
      ok: false,
      reason:
        "name the widget: nextly generate:widget <namespace>/<name> (or just <name>)",
    };
  }
  // Asked on a terminal; off one, the defaults: a figure, no setting.
  const view =
    options.view ??
    (prompter ? await prompter.view(WIDGET_VIEW_KINDS) : "figure");
  if (!isWidgetViewKind(view)) {
    return {
      ok: false,
      reason: `--view must be one of ${WIDGET_VIEW_KINDS.join(", ")}, got "${view}"`,
    };
  }
  const collection =
    options.collection ?? (prompter ? await prompter.collection() : false);
  return { ok: true, id, view, collection };
}

/** The registration edits a plan needs, and what is left for the author. */
async function registrations(
  plan: WidgetPlan,
  paths: ReturnType<typeof planPaths>
): Promise<{ edits: FileEdit[]; manual: string[] }> {
  const exportName = camelCase(plan.name);
  const edits: FileEdit[] = [];
  const manual: string[] = [];
  const target = plan.target;
  const listFile =
    target.kind === "site"
      ? target.configPath
      : await firstExisting([join(target.root, "src", "plugin.ts")]);
  if (listFile === undefined) {
    manual.push(
      `List ${exportName} (from ${paths.declaration}) in your plugin's contributes.dashboard.widgets.`
    );
  } else {
    const answer = registrationEdit({
      file: listFile,
      text: await readFile(listFile, "utf8"),
      kind: target.kind,
      exportName,
      declarationPath: paths.declaration,
    });
    if (answer.kind === "edit") edits.push(...answer.edits);
    else manual.push(answer.instructions);
  }
  if (target.kind === "plugin" && paths.component) {
    const { exportName: component } = componentRef(plan);
    const index = await firstExisting([
      join(target.root, "src", "admin", "index.ts"),
      join(target.root, "src", "admin", "index.tsx"),
    ]);
    if (index === undefined) {
      manual.push(
        `Export ${component} (from ${paths.component}) from your plugin's admin entry, so the dashboard can load it.`
      );
    } else {
      edits.push(
        adminExportEdit(
          index,
          await readFile(index, "utf8"),
          component,
          paths.component
        )
      );
    }
  }
  return { edits, manual };
}

/** What to do next, in the order an author does it. */
function nextSteps(
  plan: WidgetPlan,
  paths: ReturnType<typeof planPaths>,
  root: string,
  hasVitest: boolean
): string[] {
  const rel = (path: string) => relative(root, path);
  return [
    `Make it yours: ${rel(paths.declaration)}${paths.component ? ` and ${rel(paths.component)}` : ""}.`,
    "See it before it has data: start your dev server and open /admin/dev/widget-previews.",
    hasVitest
      ? `Run its test: npx vitest run ${rel(paths.test)}`
      : `Run its test once Vitest is installed (npm install -D vitest): npx vitest run ${rel(paths.test)}`,
  ];
}

/** The project root a target belongs to: where its package.json is. */
function rootOf(plan: WidgetPlan): string {
  return plan.target.kind === "site"
    ? dirname(plan.target.configPath)
    : plan.target.root;
}

/** The files a plan writes: the declaration, its component when it has one, its test. */
function filesOf(
  plan: WidgetPlan,
  paths: ReturnType<typeof planPaths>
): GeneratedFile[] {
  return [
    { path: paths.declaration, content: declarationSource(plan) },
    ...(paths.component
      ? [{ path: paths.component, content: componentSource(plan) }]
      : []),
    { path: paths.test, content: testSource(plan) },
  ];
}

/** Why nothing may be written over the files already there, or nothing when it may. */
async function overwriteRefusal(
  files: readonly GeneratedFile[],
  force: boolean | undefined
): Promise<string | undefined> {
  if (force) return undefined;
  const taken: string[] = [];
  for (const file of files) if (await exists(file.path)) taken.push(file.path);
  if (taken.length === 0) return undefined;
  return `nothing written: ${taken.join(", ")} already exist${taken.length === 1 ? "s" : ""} (--force overwrites)`;
}

/** Writes the files, then the registration edits. */
async function writeAll(
  files: readonly GeneratedFile[],
  edits: readonly FileEdit[],
  force: boolean | undefined
): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    // `wx` refuses a file that appeared since the check above.
    await writeFile(file.path, file.content, { flag: force ? "w" : "wx" });
  }
  for (const edit of edits) await writeFile(edit.path, edit.after);
}

/** The plan the flags and answers settle on, or why there is none. */
async function planFrom(
  cwd: string,
  options: GenerateWidgetOptions,
  prompter: WidgetPrompter | undefined
): Promise<{ ok: true; plan: WidgetPlan } | { ok: false; reason: string }> {
  const found = await findTarget(cwd, options.target);
  if (!found.ok) return found;
  const settled = await settle(options, prompter);
  if (!settled.ok) return settled;
  const id = widgetId(settled.id, found.target);
  if (!id.ok) return id;
  return {
    ok: true,
    plan: {
      id: id.id,
      name: id.name,
      view: settled.view,
      collection: settled.collection,
      target: found.target,
    },
  };
}

export async function runGenerateWidget(
  cwd: string,
  options: GenerateWidgetOptions,
  prompter?: WidgetPrompter
): Promise<GenerateWidgetResult> {
  const planned = await planFrom(cwd, options, prompter);
  if (!planned.ok) return planned;
  const { plan } = planned;
  const paths = planPaths(plan);
  const files = filesOf(plan, paths);
  const refusal = await overwriteRefusal(files, options.force);
  if (refusal !== undefined) return { ok: false, reason: refusal };

  const { edits, manual } = await registrations(plan, paths);
  const root = rootOf(plan);
  const hasVitest = await exists(join(root, "node_modules", "vitest"));
  const steps = nextSteps(plan, paths, root, hasVitest);
  if (!options.dryRun) await writeAll(files, edits, options.force);
  return {
    ok: true,
    written: !options.dryRun,
    files,
    edits,
    manual,
    nextSteps: steps,
  };
}
