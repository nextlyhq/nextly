// Prints the release manifest as JSON: every package this repo publishes, at the
// version currently in the workspace.
//
// The release workflow builds its notes from this rather than from the publish
// step's own output. A resumable release only reports the packages it published
// during that invocation, so on a recovery run the output covers just the
// stragglers, and notes built from it would claim a three-package release and
// omit the rest of the train's changelogs.

import { getReleaseManifest } from "./lib.mjs";

const manifest = getReleaseManifest().map(({ name, version }) => ({
  name,
  version,
}));

process.stdout.write(`${JSON.stringify(manifest)}\n`);
