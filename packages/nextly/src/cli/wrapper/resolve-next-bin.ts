// Resolves the path to the user project's installed `next` JS entry script.
// Why: so the Supervisor can spawn `node <script>` instead of `npx next`,
// which has a platform-specific shim (`npx.cmd`) that Node's child_process
// spawn cannot locate without shell lookup on Windows. Running `node` +
// absolute JS path is identical on every OS.
//
// Resolution strategy: createRequire anchored at the project's package.json,
// then require.resolve("next/package.json") — this follows Node's own module
// resolution, which handles pnpm hoisting and npm flat layouts the same way
// `next` would be resolved at runtime inside the project. Yarn PnP works
// when the wrapper is invoked via `yarn nextly dev` (Yarn wraps the child
// process with its PnP runtime); bare `node` invocations outside Yarn's
// scope are not supported by PnP regardless of this helper.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export class NextBinaryNotFoundError extends Error {
  constructor(projectCwd: string, cause?: unknown) {
    super(
      `Could not locate \`next\` package in ${projectCwd}. ` +
        `Is Next.js installed? Run \`npm install next\`, \`yarn add next\`, ` +
        `or \`pnpm add next\` in your project and try again.`
    );
    this.name = "NextBinaryNotFoundError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function resolveNextBinary(projectCwd: string): string {
  // Anchor createRequire on the project's package.json so Node walks the
  // project's node_modules first, not nextly's own. Matters under yalc,
  // pnpm workspaces, and monorepos where nextly is symlinked.
  const projectPkgJson = join(projectCwd, "package.json");

  let req: ReturnType<typeof createRequire>;
  try {
    req = createRequire(projectPkgJson);
  } catch (err) {
    throw new NextBinaryNotFoundError(projectCwd, err);
  }

  // Resolving next/package.json (rather than just "next") gives us next's
  // install directory without triggering the package's main module.
  let nextPkgPath: string;
  try {
    nextPkgPath = req.resolve("next/package.json");
  } catch (err) {
    throw new NextBinaryNotFoundError(projectCwd, err);
  }

  const nextPkg = req("next/package.json") as {
    bin?: string | Record<string, string>;
  };

  const binField = nextPkg.bin;
  let binRelative: string | undefined;
  if (typeof binField === "string") {
    binRelative = binField;
  } else if (binField && typeof binField === "object") {
    binRelative = binField.next;
  }

  if (!binRelative) {
    throw new NextBinaryNotFoundError(
      projectCwd,
      new Error(
        `next's package.json at ${nextPkgPath} has no usable "bin" field.`
      )
    );
  }

  return join(dirname(nextPkgPath), binRelative);
}
