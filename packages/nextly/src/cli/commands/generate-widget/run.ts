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

import { getCoreVersion } from "../../../plugins/core-version";

import {
  adminExportEdit,
  adminExportLine,
  registrationEdit,
  type FileEdit,
} from "./config-edit";
import {
  ADD_DEV,
  LOCKFILES,
  testDependencies,
  type PackageManager,
} from "./dependency";
import {
  componentRef,
  componentSource,
  declarationSource,
  isWidgetViewKind,
  testSource,
  WIDGET_VIEW_KINDS,
  type WidgetPlan,
  type WidgetViewKind,
} from "./files";
import { camelCase, widgetId } from "./id";
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
  /** The site config the root CLI's `--config` names, relative to `cwd`. */
  configPath?: string;
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

/** A file's text, or nothing when there is no file. */
const textOf = async (path: string): Promise<string | undefined> =>
  (await exists(path)) ? readFile(path, "utf8") : undefined;

/** The package manager a project installs with: by its lockfile, here or in a folder above (a workspace's), else npm. */
async function packageManagerOf(root: string): Promise<PackageManager> {
  for (let dir = root; ; dir = dirname(dir)) {
    for (const [file, manager] of LOCKFILES) {
      if (await exists(join(dir, file))) return manager;
    }
    if (dirname(dir) === dir) return "npm";
  }
}

/** The registration edits a plan needs, and what is left for the author. */
async function registrations(
  plan: WidgetPlan,
  paths: ReturnType<typeof planPaths>
): Promise<{ edits: FileEdit[]; manual: string[] }> {
  // The parser the config is read with, loaded only by this command.
  const { parse } = await import("@babel/parser");
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
      parser: parse,
      kind: target.kind,
      exportName,
      declarationPath: paths.declaration,
    });
    if (answer.kind === "edit") edits.push(...answer.edits);
    else manual.push(answer.instructions);
  }
  if (target.kind === "plugin" && paths.component) {
    const { exportName: component } = componentRef(plan);
    const index = await adminIndexOf(target.root);
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

/** What the project has, that the next steps depend on. */
interface ProjectState {
  /** Where the command ran: the paths it prints are relative to it. */
  root: string;
  manager: PackageManager;
  hasVitest: boolean;
  /** The dependencies the edits add, which only an install brings in. */
  added: readonly string[];
}

/** What to do next, in the order an author does it. */
function nextSteps(
  paths: ReturnType<typeof planPaths>,
  project: ProjectState
): string[] {
  const rel = (path: string) => relative(project.root, path);
  return [
    ...(project.added.length > 0
      ? [
          `Install what it added to package.json (${project.added.join(", ")}): ${project.manager} install`,
        ]
      : []),
    `Make it yours: ${rel(paths.declaration)}${paths.component ? ` and ${rel(paths.component)}` : ""}.`,
    "See it before it has data: start your dev server and open /admin/dev/widget-previews.",
    project.hasVitest
      ? `Run its test: npx vitest run ${rel(paths.test)}`
      : `Run its test once Vitest is installed (${ADD_DEV[project.manager]} vitest): npx vitest run ${rel(paths.test)}`,
  ];
}

/** What the generated test needs installed, added to the project where it lacks it. */
async function dependencyEdits(
  root: string
): Promise<{ edits: FileEdit[]; manual: string[]; added: string[] }> {
  const path = join(root, "package.json");
  const answer = testDependencies(path, await textOf(path), getCoreVersion());
  if (answer.kind === "edit") {
    return { edits: [answer.edit], manual: [], added: answer.added };
  }
  const manual = answer.kind === "manual" ? [answer.instructions] : [];
  return { edits: [], manual, added: [] };
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

/** Modules an extensionless import of a component could resolve to instead of its `.tsx`. */
const RIVAL_EXTENSIONS = [".ts", ".d.ts", ".js", ".jsx", ".mts", ".mjs"];

/**
 * Why the component cannot be written where it would be shadowed: a module of
 * the same name beside it, or a folder its import would resolve to. Even
 * `--force` writes nothing then, since the card would still not be imported.
 */
async function shadowRefusal(
  component: string | undefined
): Promise<string | undefined> {
  if (component === undefined) return undefined;
  const base = component.replace(/\.tsx$/, "");
  const rival = await firstExisting([
    ...RIVAL_EXTENSIONS.map(extension => `${base}${extension}`),
    base,
  ]);
  return rival === undefined
    ? undefined
    : `nothing written: ${rival} would be imported in place of the component ${component}; give the widget another name`;
}

/** The admin entry a plugin's components are exported from, when it has one. */
const adminIndexOf = (root: string): Promise<string | undefined> =>
  firstExisting([
    join(root, "src", "admin", "index.ts"),
    join(root, "src", "admin", "index.tsx"),
  ]);

/**
 * What to remove before a component widget is generated again with a core
 * view: its component, and a plugin's export of it from the admin entry.
 */
async function componentLeftovers(
  plan: WidgetPlan,
  component: string
): Promise<string> {
  const index =
    plan.target.kind === "plugin"
      ? await adminIndexOf(plan.target.root)
      : undefined;
  if (index === undefined) return component;
  const line = adminExportLine(index, componentRef(plan).exportName, component);
  return `${component} and the line \`${line}\` in ${index}`;
}

/**
 * Why `--force` may not switch a widget between a view of its own and a core
 * view: it writes over the declaration and the test but leaves a component
 * (and a plugin's export of it) that no longer fits, or the other way round
 * rewrites the widget around a component the files there were not made for.
 * Nothing is removed for the author; the refusal names what to remove first.
 */
async function viewSwitchRefusal(
  plan: WidgetPlan,
  paths: ReturnType<typeof planPaths>,
  force: boolean | undefined
): Promise<string | undefined> {
  if (!force || !(await exists(paths.declaration))) return undefined;
  const component =
    paths.component ?? planPaths({ ...plan, view: "component" }).component;
  const hadComponent = component !== undefined && (await exists(component));
  if (paths.component === undefined && hadComponent) {
    return `nothing written: ${plan.name} has a component of its own, which --view ${plan.view} would leave behind; remove ${await componentLeftovers(plan, component)} first, then run it again`;
  }
  if (paths.component !== undefined && !hadComponent) {
    return `nothing written: ${plan.name} has a core view, and --view component would rewrite it around a component; remove ${paths.declaration} and ${paths.test} first, then run it again`;
  }
  return undefined;
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
  const found = await findTarget(cwd, options.target, options.configPath);
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
  const refusal =
    (await shadowRefusal(paths.component)) ??
    (await viewSwitchRefusal(plan, paths, options.force)) ??
    (await overwriteRefusal(files, options.force));
  if (refusal !== undefined) return { ok: false, reason: refusal };

  const { root } = plan.target;
  const listed = await registrations(plan, paths);
  const dependencies = await dependencyEdits(root);
  // An edit that changes nothing (a widget generated again, already listed)
  // is neither written nor reported.
  const edits = [...listed.edits, ...dependencies.edits].filter(
    edit => edit.after !== edit.before
  );
  const steps = nextSteps(paths, {
    root,
    manager: await packageManagerOf(root),
    hasVitest: await exists(join(root, "node_modules", "vitest")),
    added: dependencies.added,
  });
  if (!options.dryRun) await writeAll(files, edits, options.force);
  return {
    ok: true,
    written: !options.dryRun,
    files,
    edits,
    manual: [...listed.manual, ...dependencies.manual],
    nextSteps: steps,
  };
}
