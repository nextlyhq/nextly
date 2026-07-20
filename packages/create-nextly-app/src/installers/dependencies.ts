import { execa } from "execa";

import type {
  DatabaseConfig,
  PackageManager,
  ProjectInfo,
  ProjectType,
} from "../types";
import { projectUsesFormBuilder } from "../utils/template";

const INSTALL_COMMANDS: Record<PackageManager, string[]> = {
  npm: ["npm", "install"],
  yarn: ["yarn", "add"],
  pnpm: ["pnpm", "add"],
  bun: ["bun", "add"],
};

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
 * `nextly.config.ts`. Must stay in sync with the deps added by
 * `generatePackageJson` (template.ts) — both paths scaffold the same project,
 * the only difference is whether deps resolve from npm or yalc. The
 * existing-project install path generates a blank-equivalent config, so it
 * never needs these.
 */
const TEMPLATE_PLUGIN_PACKAGES = ["@nextlyhq/plugin-form-builder"];

function templatePluginPackages(
  projectType: ProjectType | undefined
): string[] {
  return projectType && projectUsesFormBuilder(projectType)
    ? TEMPLATE_PLUGIN_PACKAGES
    : [];
}

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
  isFreshProject: boolean = false,
  projectType?: ProjectType
): Promise<void> {
  const pm = projectInfo.packageManager;
  const pluginPackages = templatePluginPackages(projectType);

  if (isFreshProject) {
    if (useYalc) {
      // Yalc mode: @nextlyhq/* packages were omitted from package.json by
      // generatePackageJson(useYalc: true). Install npm-only deps first,
      // then layer yalc packages on top. Include ALL adapter packages because
      // yalc file: links cause Turbopack to resolve conditional dynamic imports.
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
  } else {
    // Existing project: add specific packages to their package.json.
    const allPackages = getPackagesToInstall(database);

    if (useYalc) {
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
        const [cmd, ...args] = INSTALL_COMMANDS[pm];
        await execa(cmd, [...args, ...registryPackages], { cwd });
      }

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
