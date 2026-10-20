import path from "path";

import { execa } from "execa";
import fs from "fs-extra";

import {
  EXACT_FLAG,
  isNextlyPackage,
  type NextlySource,
} from "../lib/nextly-release";
import type {
  DatabaseConfig,
  PackageManager,
  ProjectInfo,
  ProjectType,
} from "../types";
import {
  CONFIG_TOOLING_DEV_DEPENDENCIES,
  FORM_BUILDER_PACKAGES,
  projectUsesFormBuilder,
} from "../utils/template";

import { approveNativeBuilds } from "./native-build-approvals";
import { recordLaunchingPackageManager } from "./package-manager-field";

const INSTALL_COMMANDS: Record<PackageManager, string[]> = {
  npm: ["npm", "install"],
  yarn: ["yarn", "add"],
  pnpm: ["pnpm", "add"],
  bun: ["bun", "add"],
};

/** Each manager's spelling of "add these as dev dependencies". */
const DEV_INSTALL_COMMANDS: Record<PackageManager, string[]> = {
  npm: ["npm", "install", "--save-dev"],
  yarn: ["yarn", "add", "--dev"],
  pnpm: ["pnpm", "add", "--save-dev"],
  bun: ["bun", "add", "--dev"],
};

/** `pnpm --version` in the app, or undefined when it cannot be read. */
async function readPnpmVersion(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execa("pnpm", ["--version"], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs one install command in an existing app. When it fails, the error names
 * the exact command, so the person can run it themselves and read the package
 * manager's own reason, and says how to finish once it succeeds.
 */
async function runInstall(
  [cmd, ...args]: string[],
  packages: string[],
  cwd: string
): Promise<void> {
  try {
    await execa(cmd, [...args, ...packages], { cwd });
  } catch (error) {
    const command = [cmd, ...args, ...packages].join(" ");
    const reason =
      (error as { shortMessage?: string }).shortMessage ??
      (error as Error).message;
    throw new Error(
      `Installing Nextly's packages failed.\n\n${reason}\n\n` +
        `Run this in the project to see why:\n  ${command}\n` +
        `then run create-nextly-app again.`,
      { cause: error }
    );
  }
}

/**
 * Core Nextly packages that are always installed.
 * @nextlyhq/ui is a peer dependency of admin (externalized from admin bundle).
 * @tanstack/react-query is externalized from admin to avoid duplicate instances.
 * lucide-react is a peer dependency of @nextlyhq/ui, so it must exist in the
 * consumer project rather than only inside admin's own tree.
 */
const CORE_PACKAGES = [
  "nextly",
  "@nextlyhq/admin",
  "@nextlyhq/adapter-drizzle",
  "@nextlyhq/ui",
  "@tanstack/react-query",
  "lucide-react",
];

/**
 * All database adapter packages. When using yalc (file: links), Turbopack
 * resolves the nextly package as local code rather than as an external
 * node_module, so `serverExternalPackages` doesn't prevent it from trying
 * to resolve conditional dynamic imports for all adapter packages.
 * Installing all adapters avoids "Module not found" errors at dev time.
 */
const ALL_ADAPTER_PACKAGES = [
  "@nextlyhq/adapter-postgres",
  "@nextlyhq/adapter-mysql",
  "@nextlyhq/adapter-sqlite",
];

/**
 * Plugin packages added only for templates that register the plugin in their
 * `nextly.config.ts`, read from the same list `generatePackageJson`
 * (template.ts) uses: both paths scaffold the same project, the only
 * difference is whether deps resolve from npm or yalc. The existing-project
 * install path generates a blank-equivalent config, so it never needs these.
 */
function templatePluginPackages(
  projectType: ProjectType | undefined
): string[] {
  return projectType && projectUsesFormBuilder(projectType)
    ? [...FORM_BUILDER_PACKAGES]
    : [];
}

/**
 * Get all packages that need to be installed for a given configuration.
 * Storage is not included - local disk is the default and needs no extra package.
 */
function getPackagesToInstall(database: DatabaseConfig): string[] {
  return [...CORE_PACKAGES, database.adapter];
}

/** The Nextly packages adding Nextly to an existing app installs. */
export function nextlyPackagesToInstall(database: DatabaseConfig): string[] {
  return getPackagesToInstall(database).filter(isNextlyPackage);
}

/**
 * Install Nextly and database adapter dependencies.
 * Spinners are managed by the caller.
 *
 * @param isFreshProject - When true, package.json already has all deps from
 *   copyTemplate(), so we just run `<pm> install` instead of adding packages.
 * @returns lines saying what was changed in the project's own settings, for
 *   the caller to show once its spinner stops.
 */
export async function installDependencies(
  cwd: string,
  projectInfo: ProjectInfo,
  database: DatabaseConfig,
  /** Where Nextly's packages come from; see NextlySource. */
  source: NextlySource,
  isFreshProject: boolean = false,
  projectType?: ProjectType
): Promise<string[]> {
  const pm = projectInfo.packageManager;
  const pluginPackages = templatePluginPackages(projectType);
  const useYalc = source.kind === "yalc";

  if (!isFreshProject) {
    return installIntoExistingApp(cwd, pm, database, source, pluginPackages);
  }

  if (useYalc) {
    // Yalc mode: @nextlyhq/* packages were omitted from package.json by
    // generatePackageJson(useYalc: true). Install npm-only deps first,
    // then layer yalc packages on top. Include ALL adapter packages because
    // yalc file: links cause Turbopack to resolve conditional dynamic imports.
    // A plugin scaffold imports @nextlyhq/plugin-sdk directly, so it is linked
    // too; otherwise the local packages would run against the published SDK.
    const yalcPackages = [
      ...new Set([
        "nextly",
        "@nextlyhq/admin",
        "@nextlyhq/ui",
        "@nextlyhq/adapter-drizzle",
        ...ALL_ADAPTER_PACKAGES,
        ...pluginPackages,
        ...(projectType === "plugin" ? ["@nextlyhq/plugin-sdk"] : []),
      ]),
    ];

    // Step 1: Install non-@nextlyhq packages
    await execa(pm, ["install"], { cwd });

    // Step 2: Add @nextlyhq/* packages from local yalc store
    for (const pkg of yalcPackages) {
      await execa("yalc", ["add", pkg], { cwd });
    }

    // Step 3: Install again to resolve yalc transitive dependencies
    await execa(pm, ["install"], { cwd });
  } else {
    // Plain install - all deps are already in package.json
    await execa(pm, ["install"], { cwd });
  }
  // A fresh scaffold's settings are written whole by the template, so there
  // is nothing in the project's own files to report.
  return [];
}

/**
 * Existing project: add Nextly's packages to its package.json, plus the dev
 * dependencies reading `nextly.config.ts` needs, which a fresh scaffold writes
 * into its package.json and nothing else installs: `nextly` takes esbuild only
 * as an optional peer.
 *
 * On pnpm and Bun, the native packages' install scripts are approved first:
 * pnpm 11 and later refuse an install while one is unapproved, and Bun skips
 * it, which left the SQLite driver without its compiled binding.
 */
async function installIntoExistingApp(
  cwd: string,
  pm: PackageManager,
  database: DatabaseConfig,
  source: NextlySource,
  pluginPackages: string[]
): Promise<string[]> {
  // First, so the pnpm version the approvals read and the version that
  // installs are the one recorded.
  const recorded = await recordLaunchingPackageManager(cwd, pm);
  const notes = [
    ...(recorded
      ? [
          `Set packageManager to ${recorded} in package.json, the version that ran this, so Corepack installs with it.`,
        ]
      : []),
    ...(await approveNativeBuilds(
      cwd,
      pm,
      pm === "pnpm" ? await readPnpmVersion(cwd) : undefined
    )),
  ];
  try {
    await installPackages(cwd, pm, database, source, pluginPackages);
  } catch (error) {
    // The notes are printed after a successful install, so a failed one
    // carries them: a version-scoped rule the app kept is what makes pnpm
    // stop, and the note says what to do then.
    if (notes.length === 0) throw error;
    throw new Error(`${(error as Error).message}\n\n${notes.join("\n")}`, {
      cause: error,
    });
  }
  return notes;
}

async function installPackages(
  cwd: string,
  pm: PackageManager,
  database: DatabaseConfig,
  source: NextlySource,
  pluginPackages: string[]
): Promise<void> {
  const allPackages = getPackagesToInstall(database);
  if (source.kind === "yalc") {
    await installWithYalc(cwd, pm, allPackages, pluginPackages);
  } else {
    // The others first: they include peers Nextly's packages require
    // (@nextlyhq/ui needs lucide-react), and pnpm with auto-install-peers off
    // and strict-peer-dependencies on refuses an add whose required peers
    // are not there yet. They go in a command of their own, at what the
    // registry has, so the exact flag below never pins them.
    const others = allPackages.filter(pkg => !isNextlyPackage(pkg));
    if (others.length > 0) {
      await runInstall(INSTALL_COMMANDS[pm], others, cwd);
    }
    // Nextly's packages at the release, recorded exactly as a new project
    // declares them: npm records `nextly@X` as `^X` unless told not to, and a
    // range would float to a later release. On the alpha line, the tag.
    const release = source.kind === "release";
    const spec = release ? source.cliVersion : "alpha";
    await runInstall(
      [...INSTALL_COMMANDS[pm], ...(release ? [EXACT_FLAG[pm]] : [])],
      allPackages.filter(isNextlyPackage).map(pkg => `${pkg}@${spec}`),
      cwd
    );
  }
  const tooling = await notYetDeclared(cwd, CONFIG_TOOLING_DEV_DEPENDENCIES);
  if (tooling.length > 0) {
    await runInstall(DEV_INSTALL_COMMANDS[pm], tooling, cwd);
  }
}

/**
 * The specifiers whose package the app's package.json does not declare yet.
 * One it declares stays as the app wrote it: an app that runs migrations on
 * boot keeps esbuild in `dependencies`, and a `--save-dev` install would move
 * it to `devDependencies`, which a production install omits.
 */
async function notYetDeclared(
  cwd: string,
  specifiers: readonly string[]
): Promise<string[]> {
  const declared = new Set<string>();
  try {
    const pkg = (await fs.readJson(path.join(cwd, "package.json"))) as Record<
      string,
      unknown
    >;
    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field];
      if (deps && typeof deps === "object") {
        for (const name of Object.keys(deps)) declared.add(name);
      }
    }
  } catch {
    // No readable package.json: nothing is declared, so everything is added.
  }
  return specifiers.filter(spec => !declared.has(packageName(spec)));
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** `esbuild@^0.28.1` → `esbuild`; `@scope/pkg@1` → `@scope/pkg`. */
const packageName = (specifier: string): string => {
  const at = specifier.lastIndexOf("@");
  return at > 0 ? specifier.slice(0, at) : specifier;
};

async function installWithYalc(
  cwd: string,
  pm: PackageManager,
  allPackages: string[],
  pluginPackages: string[]
): Promise<void> {
  const yalcPackages = [
    ...new Set([
      "nextly",
      "@nextlyhq/admin",
      "@nextlyhq/ui",
      "@nextlyhq/adapter-drizzle",
      ...ALL_ADAPTER_PACKAGES,
      ...pluginPackages,
    ]),
  ];

  // Everything else in the install set comes from npm, not the yalc store:
  // @tanstack/react-query and lucide-react are externalised from the admin
  // bundle and peer-required by @nextlyhq/ui, so `yalc add` would never
  // provide them and the peers would stay unresolved.
  const registryPackages = allPackages.filter(
    pkg => !yalcPackages.includes(pkg)
  );

  if (registryPackages.length > 0) {
    await runInstall(INSTALL_COMMANDS[pm], registryPackages, cwd);
  }

  for (const pkg of yalcPackages) {
    await execa("yalc", ["add", pkg], { cwd });
  }

  await execa(pm, ["install"], { cwd });
}
