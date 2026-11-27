import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SITE_NOTICE_VERSION,
  TOOLS_NOTICE_VERSION,
  usageCatalogData,
  type UsageCatalogData,
} from "../index.js";

// People are told again when Nextly collects more. `notice-catalog.json` keeps,
// for each notice version, every event and property the installer and the CLI
// (`tools`) and sites (`site`) send under it. Adding an event or a property
// without raising that audience's notice version fails here; raising the
// version means adding its entry, which leaves a record of what each notice
// covered. Removing one needs no new notice, so it passes.

type Snapshot = Record<
  "tools" | "site",
  Record<string, Record<string, string[]>>
>;

const snapshotPath = fileURLToPath(
  new URL("./notice-catalog.json", import.meta.url)
);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

/** Each event an audience sends, with all the properties it may carry. */
function audienceCatalog(
  data: UsageCatalogData,
  audience: "tools" | "site"
): Record<string, string[]> {
  const base = data.base_properties[audience];
  const out: Record<string, string[]> = {};
  for (const [name, spec] of Object.entries(data.events)) {
    const forAudience = spec.sources.some(source =>
      audience === "site" ? source === "site" : source !== "site"
    );
    if (!forAudience) continue;
    out[name] = [
      ...Object.keys(base.required),
      ...Object.keys(base.optional),
      ...Object.keys(spec.required),
      ...Object.keys(spec.optional),
    ].sort();
  }
  return out;
}

/** What `current` sends that `noticed` did not cover, as "event.property". */
function added(
  current: Record<string, string[]>,
  noticed: Record<string, string[]> | undefined
): string[] {
  return Object.entries(current).flatMap(([event, properties]) => {
    const known = noticed?.[event];
    if (!known) return [event];
    return properties.filter(p => !known.includes(p)).map(p => `${event}.${p}`);
  });
}

describe("the notice version rises with the catalog", () => {
  const data = usageCatalogData();

  it.each([
    ["tools", TOOLS_NOTICE_VERSION],
    ["site", SITE_NOTICE_VERSION],
  ] as const)(
    "%s: everything sent was covered by notice version %i",
    (audience, version) => {
      const noticed = snapshot[audience][String(version)];
      const current = audienceCatalog(data, audience);
      expect(
        noticed,
        `notice-catalog.json has no "${audience}" entry for notice version ${version}: add one listing what this version covers`
      ).toBeDefined();
      expect(
        added(current, noticed),
        `the catalog adds these for "${audience}" without a new notice: raise its notice version in usage/catalog.ts and add the new version to notice-catalog.json`
      ).toEqual([]);
    }
  );

  it("finds a change: one property added without a new version", () => {
    const data2 = usageCatalogData();
    const commandRun = data2.events.command_run;
    if (!commandRun) throw new Error("command_run is missing");
    data2.events.command_run = {
      ...commandRun,
      optional: { ...commandRun.optional, flags: { type: "boolean" } },
    };
    const noticed = snapshot.tools[String(TOOLS_NOTICE_VERSION)];
    expect(added(audienceCatalog(data2, "tools"), noticed)).toEqual([
      "command_run.flags",
    ]);
  });
});
