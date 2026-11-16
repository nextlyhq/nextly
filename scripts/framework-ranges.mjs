/**
 * The Next.js, React and React DOM ranges Nextly supports, read from where
 * they are declared: the `nextly` package's own peer ranges.
 *
 * For a build or test config that inlines them into a package which must not
 * depend on `nextly` at run time (`create-nextly-app`, through `define`). The
 * `nextly` runtime reads the same manifest itself.
 */
import { readFileSync } from "node:fs";

const PACKAGES = ["next", "react", "react-dom"];

/** `{ next, react, "react-dom" }`, each the range `nextly` declares as a peer. */
export function frameworkRanges() {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../packages/nextly/package.json", import.meta.url),
      "utf8"
    )
  );
  const peers = manifest.peerDependencies ?? {};
  const missing = PACKAGES.filter(name => !peers[name]);
  if (missing.length > 0) {
    throw new Error(
      `packages/nextly/package.json declares no peer range for ${missing.join(", ")}`
    );
  }
  return Object.fromEntries(PACKAGES.map(name => [name, peers[name]]));
}
