import path from "path";

import fs from "fs-extra";

/**
 * Check if the current directory is a Next.js project.
 */
export async function isExistingNextProject(cwd: string): Promise<boolean> {
  const packageJsonPath = path.join(cwd, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) return false;

  try {
    const packageJson = await fs.readJson(packageJsonPath);
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    return "next" in deps;
  } catch {
    return false;
  }
}
