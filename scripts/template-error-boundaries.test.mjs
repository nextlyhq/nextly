/**
 * Every error boundary a template ships recovers with `retry()`, never
 * `reset()`.
 *
 * `retry()` fetches the failed segment again and re-renders it, so a transient
 * server failure (a database blip, a flaky upstream call) can recover from the
 * button. `reset()` only re-renders what already failed, so the same button
 * shows the same error. The behaviour itself is proven in a browser by
 * `e2e/tests/render-retry.spec.ts`; that each shipped button calls the
 * `retry` it is handed is checked by rendering every boundary, in
 * create-nextly-app's `template-error-boundaries-retry.test.ts`. This holds
 * each template to the call, and to never using `reset`.
 *
 * A scan over source, so its reading carries controls of its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;

/** The Next.js error boundary files, by name. */
const BOUNDARY_FILE = /^(?:global-)?error\.[jt]sx?$/;

/**
 * Why a boundary's source is refused, or null when it recovers with retry().
 * Comments are dropped first, so prose explaining the choice is not code.
 */
export function boundaryProblem(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (/\breset\b/.test(code)) return "uses reset";
  if (!/\bretry\s*\(\s*\)/.test(code)) return "never calls retry()";
  return null;
}

/** Every error boundary file under `dir`. */
function boundaryFiles(dir) {
  const files = [];
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(child);
      } else if (BOUNDARY_FILE.test(entry.name)) {
        files.push(child);
      }
    }
  };
  walk(dir);
  return files;
}

describe("template error boundaries", () => {
  it("the reading refuses reset and an unused retry, and passes a retry call", () => {
    expect(
      boundaryProblem(
        "export default function E({ reset }) { return <button onClick={reset} /> }"
      )
    ).toBe("uses reset");
    expect(
      boundaryProblem("export default function E({ retry }) { return <p /> }")
    ).toBe("never calls retry()");
    expect(
      boundaryProblem(
        "export default function E({ retry }) { return <button onClick={() => retry()} /> }"
      )
    ).toBeNull();
    expect(
      boundaryProblem(
        "/** `reset` would only re-render. */\n// not reset\nexport default function E({ retry }) { return <button onClick={() => retry()} /> }"
      )
    ).toBeNull();
  });

  it("every one recovers with retry()", () => {
    const files = boundaryFiles(join(ROOT, "templates"));
    const read = files.map(file => relative(ROOT, file));
    // The scan reached the blog's three boundaries: the frontend's, the root's
    // and the global one.
    expect(read).toEqual(
      expect.arrayContaining([
        "templates/blog/src/app/(frontend)/error.tsx",
        "templates/blog/src/app/error.tsx",
        "templates/blog/src/app/global-error.tsx",
      ])
    );
    const problems = files
      .map(file => [
        relative(ROOT, file),
        boundaryProblem(readFileSync(file, "utf8")),
      ])
      .filter(([, problem]) => problem !== null);
    expect(problems).toEqual([]);
  });
});
