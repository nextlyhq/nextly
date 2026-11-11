/**
 * The install step `nextly plugins add` adds to a site's build script.
 *
 * A production boot refuses a configured plugin that no `nextly plugins
 * install` has run for on its database, so a site's build migrates and then
 * installs each plugin before building the app, as `create-nextly-app` writes
 * it: `nextly migrate && nextly plugins install <name> && next build`. The new
 * plugin's step goes right after the last of those steps, run the way they
 * are run (`nextly`, `npx nextly`, `pnpm exec nextly`). A build that installs
 * it already, or every plugin with `--all`, is left as it is. A build with no
 * such step, or a package.json that cannot be read, is left as it was too,
 * and the step is returned for the person to add where their build migrates.
 *
 * @module cli/commands/plugins-add/build-script
 */

export type BuildScriptEdit =
  /** The package.json with the step in its build script. */
  | { kind: "edit"; after: string; script: string }
  /** The build installs the plugin already. */
  | { kind: "installed" }
  /** Why the build was left as it was, and the step to add. */
  | { kind: "manual"; reason: string; step: string };

/** A `nextly migrate` or `nextly plugins install` step, and how it runs nextly. */
const NEXTLY_STEP =
  /^((?:npx|pnpm(?:\s+exec)?|yarn|bunx)\s+)?nextly\s+(migrate|plugins\s+install)(?:\s+(.*))?$/;

/** A plugin name a shell reads as one word, with nothing it would act on. */
const SHELL_SAFE_NAME = /^[A-Za-z0-9@/._-]+$/;

/** One `&&`-separated step of a script, trimmed, and where it ends in the script. */
interface Step {
  text: string;
  end: number;
}

function stepsOf(script: string): Step[] {
  const steps: Step[] = [];
  let start = 0;
  for (;;) {
    const and = script.indexOf("&&", start);
    const raw = script.slice(start, and === -1 ? undefined : and);
    const text = raw.trim();
    steps.push({ text, end: start + raw.trimEnd().length });
    if (and === -1) return steps;
    start = and + 2;
  }
}

/** The indentation package.json is written with, so the rewrite keeps it. */
function indentOf(text: string): string {
  return /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
}

/** The edit that installs `pluginName` in the build, or why there is none. */
export function buildScriptEdit(
  manifestText: string,
  pluginName: string
): BuildScriptEdit {
  const step = `nextly plugins install ${pluginName}`;
  const manual = (reason: string): BuildScriptEdit => ({
    kind: "manual",
    reason,
    step,
  });
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return manual("package.json could not be read");
  }
  const scripts =
    typeof manifest === "object" && manifest !== null
      ? (manifest as { scripts?: unknown }).scripts
      : undefined;
  const build =
    typeof scripts === "object" && scripts !== null
      ? (scripts as { build?: unknown }).build
      : undefined;
  if (typeof build !== "string") {
    return manual("package.json has no build script");
  }

  const steps = stepsOf(build).map(each => ({
    ...each,
    match: NEXTLY_STEP.exec(each.text),
  }));
  const installs = steps.some(({ match }) => {
    if (match === null || match[2] === "migrate") return false;
    const args = (match[3] ?? "").split(/\s+/);
    return args.includes("--all") || args.includes(pluginName);
  });
  if (installs) return { kind: "installed" };

  const last = steps.filter(each => each.match !== null).at(-1);
  if (last === undefined) {
    return manual("The build script runs no `nextly migrate`");
  }
  if (!SHELL_SAFE_NAME.test(pluginName)) {
    return manual(
      `The name "${pluginName}" is not one a script can carry as written`
    );
  }
  const runner = last.match?.[1] ?? "";
  const script = `${build.slice(0, last.end)} && ${runner}${step}${build.slice(last.end)}`;
  const edited = {
    ...(manifest as object),
    scripts: { ...(scripts as object), build: script },
  };
  const trailing = manifestText.endsWith("\n") ? "\n" : "";
  return {
    kind: "edit",
    after: `${JSON.stringify(edited, null, indentOf(manifestText))}${trailing}`,
    script,
  };
}
