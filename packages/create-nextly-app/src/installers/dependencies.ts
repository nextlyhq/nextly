import { execa } from "execa";

import type { DatabaseConfig, PackageManager, ProjectInfo } from "../types";

const INSTALL_COMMANDS: Record<PackageManager, string[]> = {
  npm: ["npm", "install"],
  yarn: ["yarn", "add"],
  pnpm: ["pnpm", "add"],
  bun: ["bun", "add"],
};

/**
 * Core Nextly packages that are always installed.
 * @revnixhq/ui is a peer dependency of admin (externalized from admin bundle).
 * @tanstack/react-query is externalized from admin to avoid duplicate instances.
 */
const CORE_PACKAGES = [
  "@revnixhq/nextly",
  "@revnixhq/admin",
  "@revnixhq/adapter-drizzle",
  "@revnixhq/ui",
  "@tanstack/react-query",
];

/**
 * All database adapter packages. When using yalc (file: links), Turbopack
 * resolves the nextly package as local code rather than as an external
 * node_module, so `serverExternalPackages` doesn't prevent it from trying
 * to resolve conditional dynamic imports for all adapter packages.
 * Installing all adapters avoids "Module not found" errors at dev time.
 */
const ALL_ADAPTER_PACKAGES = [
  "@revnixhq/adapter-postgres",
  "@revnixhq/adapter-mysql",
  "@revnixhq/adapter-sqlite",
];

/**
 * Plugin packages that are shipped with every scaffold. Must stay in sync
 * with the plugin deps added in `generatePackageJson` (template.ts) - both
 * paths scaffold the same project, the only difference is whether deps
 * resolve from npm or yalc. Omitting these from the yalc list caused
 * runtime "Cannot find package '@revnixhq/plugin-form-builder'" errors
 * in scaffolded projects whose templates import the plugin.
 */
const TEMPLATE_PLUGIN_PACKAGES = [
  "@revnixhq/plugin-form-builder",
];

/**
 * Get all packages that need to be installed for a given configuration.
 * Storage is not included - local disk is the default and needs no extra package.
 */
function getPackagesToInstall(database: DatabaseConfig): string[] {
  return [...CORE_PACKAGES, database.adapter];
}

/**
 * Install Nextly and database adapter dependencies.
 * Spinners are managed by the caller.
 *
 * @param isFreshProject - When true, package.json already has all deps from
 *   copyTemplate(), so we just run `<pm> install` instead of adding packages.
 */
export async function installDependencies(
  cwd: string,
  projectInfo: ProjectInfo,
  database: DatabaseConfig,
  useYalc: boolean = false,
  isFreshProject: boolean = false
): Promise<void> {
  const pm = projectInfo.packageManager;

  if (isFreshProject) {
    if (useYalc) {
      // Yalc mode: @revnixhq/* packages were omitted from package.json by
      // generatePackageJson(useYalc: true). Install npm-only deps first,
      // then layer yalc packages on top. Include ALL adapter packages because
      // yalc file: links cause Turbopack to resolve conditional dynamic imports.
      const yalcPackages = [
        ...new Set([
          "@revnixhq/nextly",
          "@revnixhq/admin",
          "@revnixhq/ui",
          "@revnixhq/adapter-drizzle",
          ...ALL_ADAPTER_PACKAGES,
          ...TEMPLATE_PLUGIN_PACKAGES,
        ]),
      ];

      // Step 1: Install non-@revnixhq packages
      await execa(pm, ["install"], { cwd });

      // Step 2: Add @revnixhq/* packages from local yalc store
      for (const pkg of yalcPackages) {
        await execa("yalc", ["add", pkg], { cwd });
      }

      // Step 3: Install again to resolve yalc transitive dependencies
      await execa(pm, ["install"], { cwd });
    } else {
      // Plain install - all deps are already in package.json
      await execa(pm, ["install"], { cwd });
    }
  } else {
    // Existing project: add specific packages to their package.json.
    const allPackages = getPackagesToInstall(database);

    if (useYalc) {
      const yalcPackages = [
        ...new Set([
          "@revnixhq/nextly",
          "@revnixhq/admin",
          "@revnixhq/ui",
          "@revnixhq/adapter-drizzle",
          ...ALL_ADAPTER_PACKAGES,
          ...TEMPLATE_PLUGIN_PACKAGES,
        ]),
      ];

      for (const pkg of yalcPackages) {
        await execa("yalc", ["add", pkg], { cwd });
      }

      await execa(pm, ["install"], { cwd });
    } else {
      const [cmd, ...args] = INSTALL_COMMANDS[pm];
      await execa(cmd, [...args, ...allPackages], { cwd });
    }
  }
}
