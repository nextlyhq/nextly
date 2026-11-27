import { describe, expect, it } from "vitest";

import {
  CATALOG_VERSION,
  openSiteUsage,
  openToolsUsage,
  type ToolsSource,
} from "../index.js";

import { MACHINE_ID, SITE_ID, recordingFetch } from "./usage-helpers.js";

// Every event carries its source, the catalog's version and the Nextly
// version; an installer or CLI event also says who ran it and on what; a site
// event says the site's role. All of them are the session's to add: a caller
// cannot set or change them.

interface Sent {
  event: string;
  properties: Record<string, unknown>;
}

async function toolsEvent(
  source: ToolsSource,
  env: Record<string, string>,
  props: Record<string, unknown> = {}
): Promise<Sent> {
  const recorder = recordingFetch();
  const session = openToolsUsage({
    source,
    nextlyVersion: "0.0.2-alpha.81",
    distinctId: MACHINE_ID,
    machineEnabled: true,
    env,
    fetch: recorder.fetch,
    agentFileExists: () => false,
  });
  if (source === "installer") {
    session.capture("install_started", {
      from: "home",
      terminal: true,
      ...props,
    });
  } else {
    session.capture("command_run", {
      command: "schema pull",
      alias: false,
      role: "none",
      ...props,
    });
  }
  await session.flush();
  const body = recorder.calls[0]?.body as { batch: Sent[] };
  return body.batch[0] as Sent;
}

describe("base properties", () => {
  it.each(["installer", "cli"] as const)(
    "%s events carry the tools' base properties",
    async source => {
      const sent = await toolsEvent(source, {
        npm_config_user_agent: "pnpm/12.5.1 npm/? node/v24.21.0 linux x64",
      });
      expect(sent.properties).toMatchObject({
        source,
        catalog_version: CATALOG_VERSION,
        nextly_version: "0.0.2-alpha.81",
        run_by: "person",
        package_manager: "pnpm",
        node_major: Number(process.versions.node.split(".")[0]),
      });
      expect(["darwin", "linux", "win32", "freebsd", "other"]).toContain(
        sent.properties.os
      );
      expect(["arm64", "x64", "other"]).toContain(sent.properties.arch);
      expect(sent.properties).not.toHaveProperty("agent");
    }
  );

  it("an agent's run carries run_by agent and the agent's name", async () => {
    const sent = await toolsEvent("cli", { AI_AGENT: "claude" });
    expect(sent.properties).toMatchObject({ run_by: "agent", agent: "claude" });
  });

  it("a caller cannot set a base property, even one the session left out", async () => {
    const sent = await toolsEvent(
      "cli",
      {},
      { source: "site", run_by: "agent", agent: "claude", catalog_version: 1 }
    );
    expect(sent.properties).toMatchObject({
      source: "cli",
      run_by: "person",
      catalog_version: CATALOG_VERSION,
    });
    expect(sent.properties).not.toHaveProperty("agent");
  });

  it("site events carry the site's base properties and its id", async () => {
    const recorder = recordingFetch();
    const session = openSiteUsage({
      nextlyVersion: "0.0.2-alpha.81",
      siteId: SITE_ID,
      role: "staging",
      switchOn: true,
      env: {},
      fetch: recorder.fetch,
    });
    session.capture("first_page_published", {});
    session.capture("admin_first_opened", {
      heard_from: "not_asked",
      run_by: "agent",
      agent: "codex",
    });
    await session.flush();
    const [published, opened] = (
      recorder.calls[0]?.body as {
        batch: (Sent & { distinct_id: string })[];
      }
    ).batch;
    expect(published?.distinct_id).toBe(SITE_ID);
    expect(published?.properties).toEqual({
      source: "site",
      catalog_version: CATALOG_VERSION,
      nextly_version: "0.0.2-alpha.81",
      role: "staging",
      distinct_id: SITE_ID,
      $process_person_profile: false,
      $geoip_disable: true,
    });
    // Only the first admin is made by someone, so only it says who.
    expect(opened?.properties).toMatchObject({
      source: "site",
      run_by: "agent",
      agent: "codex",
      heard_from: "not_asked",
    });
  });
});
