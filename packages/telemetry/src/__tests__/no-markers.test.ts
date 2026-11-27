import { describe, expect, it } from "vitest";

import {
  countRange,
  detectAgent,
  installErrorCode,
  newRandomId,
  openSiteUsage,
  openToolsUsage,
  pageLabelFrom,
  pluginsOn,
} from "../index.js";

import { MACHINE_ID, SITE_ID, recordingFetch } from "./usage-helpers.js";

// Nothing that names a person, a project, a site or its content leaves the
// machine. A project and a site are built whose every name, path, slug,
// address and error carries a marker string, every builder and every event is
// run against them, and the marker must appear in no request.
//
// One value is out of this test's reach on purpose: the CLI command's name.
// The catalog allows any short lowercase command name ("schema pull"),
// because the CLI's operation list, not this package, reduces a generated or
// third-party command to its generic shape ("content create", "plugin
// command"). A lowercase marker passed straight in as a command would be sent;
// the CLI's own tests hold that reduction.

const MARKER = "ZqMrk";
const has = (text: string) => text.toLowerCase().includes(MARKER.toLowerCase());

// The project and the site, as the surfaces would see them.
const project = {
  name: `${MARKER}-site`,
  path: `/home/${MARKER}/projects/${MARKER}-site`,
  winPath: `C:\\Users\\${MARKER}\\${MARKER}-site`,
  email: `${MARKER}@example.com`,
  url: `https://${MARKER}.example.com/admin`,
  connection: `postgres://${MARKER}:secret@db.${MARKER}.io:5432/${MARKER}`,
  collection: `${MARKER}_posts`,
  plugin: `@${MARKER}/private-plugin`,
};

const env: Record<string, string> = {
  PWD: project.path,
  INIT_CWD: project.path,
  HOME: `/home/${MARKER}`,
  USER: MARKER,
  npm_package_name: project.name,
  npm_config_user_agent: `pnpm/12.5.1 npm/? node/v24.21.0 ${project.path}`,
  DATABASE_URL: project.connection,
  NEXT_PUBLIC_SITE_URL: project.url,
  AI_AGENT: `${MARKER}-bot`,
};

const markedError = Object.assign(
  new Error(`EACCES: permission denied, open '${project.path}/.env'`),
  { code: "EACCES", path: `${project.path}/.env`, syscall: "open" }
);

describe("no marker leaves in any payload", () => {
  it("the builders answer only catalog values for marked input", () => {
    const answers = [
      pageLabelFrom(project.name),
      pageLabelFrom(project.url),
      pageLabelFrom(project.email),
      pluginsOn([project.plugin, `${MARKER}-plugin`, "@nextlyhq/plugin-seo"]),
      installErrorCode(markedError, "install"),
      installErrorCode(markedError, "db"),
      countRange(project.name.length),
      detectAgent(env, { fileExists: () => false }),
      newRandomId(),
    ];
    expect(has(JSON.stringify(answers))).toBe(false);
    // The answers are real ones, not empty: the marked plugin was counted.
    expect(answers[3]).toEqual({
      plugins_official: ["@nextlyhq/plugin-seo"],
      plugins_other: 2,
    });
  });

  it("every event, given marked values wherever a caller could slip one in", async () => {
    const tools = recordingFetch();
    const site = recordingFetch();
    const installer = openToolsUsage({
      source: "installer",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env,
      fetch: tools.fetch,
      agentFileExists: () => false,
    });
    const cli = openToolsUsage({
      source: "cli",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env,
      fetch: tools.fetch,
      agentFileExists: () => false,
    });
    const running = openSiteUsage({
      nextlyVersion: "1.2.3",
      siteId: SITE_ID,
      role: "production",
      switchOn: true,
      env,
      fetch: site.fetch,
    });

    // Marked values cast past the types, as plain JavaScript could pass them.
    const m = <T>(value: unknown) => value as T;
    const plugins = pluginsOn([project.plugin, "@nextlyhq/plugin-seo"]);

    installer.capture("install_started", {
      from: pageLabelFrom(project.url),
      terminal: false,
      install_id: m(project.name),
    });
    installer.capture("install_step", {
      section: "project",
      start: "website",
      features: m(["page_builder", project.plugin]),
      install_id: newRandomId(),
    });
    installer.capture("install_completed", {
      duration_ms: 1200,
      database: m(project.connection),
    });
    installer.capture("install_failed", {
      step: "set_up_database",
      error_code: installErrorCode(markedError, "db"),
      duration_ms: 4000,
    });
    cli.capture("command_run", {
      command: "migrate",
      alias: false,
      role: "local",
      exit_code: 1,
      error_code: m(markedError.message),
      duration_ms: 31,
    });
    cli.capture("command_run", {
      command: m(project.path),
      alias: false,
      role: "local",
    });
    running.capture("admin_first_opened", {
      heard_from: m(project.email),
      run_by: "person",
    });
    running.capture("admin_first_opened", {
      heard_from: "friend",
      run_by: "person",
      install_id: m(project.collection),
    });
    running.capture("first_collection_created", {});
    running.capture("first_page_published", {});
    running.capture("daily_summary", {
      database: "postgresql",
      collections: countRange(12),
      singles: countRange(0),
      published_documents: countRange(450),
      ...plugins,
    });
    running.capture("daily_summary", {
      database: "postgresql",
      collections: "1-10",
      singles: "0",
      published_documents: "0",
      plugins_official: m([project.plugin]),
      plugins_other: 0,
    });

    await Promise.all([installer.flush(), cli.flush(), running.flush()]);
    const sent = [...tools.calls, ...site.calls];
    const everything = JSON.stringify(sent);

    // The search is live: it finds a marker where one is.
    expect(has(JSON.stringify({ x: project.path }))).toBe(true);
    // Something was sent from all three sources.
    const events = sent.flatMap(
      call => (call.body as { batch: { event: string }[] }).batch
    );
    expect(new Set(events.map(e => e.event))).toEqual(
      new Set([
        "install_started",
        "install_step",
        "install_completed",
        "install_failed",
        "command_run",
        "admin_first_opened",
        "first_collection_created",
        "first_page_published",
        "daily_summary",
      ])
    );
    expect(has(everything)).toBe(false);
  });
});
