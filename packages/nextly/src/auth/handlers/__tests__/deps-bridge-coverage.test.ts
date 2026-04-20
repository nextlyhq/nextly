/**
 * DI-registration coverage guard.
 *
 * If anything in `deps-bridge.ts` calls `getService("xyz")` for a service
 * that was never registered (as happened with `authService` in Task 10 —
 * caught only when the signup flow 500'd end-to-end), this test fails.
 *
 * We do not boot the full DI container here (that needs a database). We
 * instead statically scan deps-bridge.ts for every `getService("...")`
 * call and assert each name is listed on the `ServiceMap` type, and that
 * a matching `container.registerSingleton("...")` or `registerTransient`
 * exists somewhere under `di/registrations/`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_NEXTLY_SRC = join(__dirname, "..", "..", "..");
const DEPS_BRIDGE = join(REPO_NEXTLY_SRC, "auth", "handlers", "deps-bridge.ts");
const DI_DIR = join(REPO_NEXTLY_SRC, "di");

function stripComments(source: string): string {
  // Strip `/* ... */` block comments, then `// ...` line comments. Good
  // enough for this guard — regex-level accuracy is fine since we are
  // not parsing code, just preventing commented-out registrations from
  // satisfying the test.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readAllRecursive(dir: string): string {
  let out = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out += readAllRecursive(join(dir, entry.name));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    out += readFileSync(join(dir, entry.name), "utf-8") + "\n";
  }
  return stripComments(out);
}

describe("deps-bridge DI registration coverage", () => {
  it("every getService(...) call in deps-bridge has a matching container registration and ServiceMap entry", () => {
    const bridgeSource = readFileSync(DEPS_BRIDGE, "utf-8");
    const diSource = readAllRecursive(DI_DIR);

    const serviceNames = Array.from(
      new Set(
        Array.from(bridgeSource.matchAll(/getService\(\s*"([^"]+)"\s*\)/g)).map(
          m => m[1]
        )
      )
    );

    expect(serviceNames.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const name of serviceNames) {
      // Registration can look like:
      //   container.registerSingleton<T>("name", ...)
      //   container.registerTransient<T>("name", ...)
      //   container.register("name", ...)
      //   container.registerFactory("name", ...)
      const registrationPattern = new RegExp(
        `container\\.(registerSingleton|registerTransient|register|registerFactory)(<[^>]+>)?\\(\\s*"${name}"`
      );
      // ServiceMap entry: `name: SomeType;`
      const serviceMapPattern = new RegExp(
        `^\\s*${name}\\s*:\\s*[A-Za-z_][A-Za-z0-9_]*`,
        "m"
      );

      const hasFactory = registrationPattern.test(diSource);
      const hasType = serviceMapPattern.test(diSource);

      if (!hasFactory || !hasType) {
        missing.push(`${name} — registered=${hasFactory} typed=${hasType}`);
      }
    }

    expect(
      missing,
      `services referenced in deps-bridge but missing registration and/or ServiceMap entry:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });
});
