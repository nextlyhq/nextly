/**
 * The usage-data catalog as a compile-time contract: only the catalog's
 * events, each only from its own source, each with only its own properties
 * and allowed values, compile.
 *
 * Each `@ts-expect-error` names, after the directive, the one diagnostic it
 * expects. `tsc` does not read that name; `catalog-contract.test.ts` does. It
 * compiles this file as written (no error may remain, so no directive is
 * unused) and again with every directive removed, and requires exactly the
 * named diagnostic on each directive's line and nothing anywhere else. A
 * directive suppressing a typo or an unrelated error fails that test.
 */
import type { ErrorCode } from "../index.js";
import {
  INSTALL_ERROR_CODES,
  type SiteUsageSession,
  type ToolsUsageSession,
  type UsageEventFor,
} from "../index.js";

/** True only when `A` and `B` are the same type, not merely assignable. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Compiles only for `true`: each use states one fact of the contract. */
function holds<Fact extends true>(): Fact | undefined {
  return undefined;
}

declare const tools: ToolsUsageSession;
declare const site: SiteUsageSession;

// Which source may send which event.
holds<
  Same<
    UsageEventFor<"installer">,
    "install_started" | "install_step" | "install_completed" | "install_failed"
  >
>();
holds<Same<UsageEventFor<"cli">, "command_run">>();
holds<
  Same<
    UsageEventFor<"site">,
    | "admin_first_opened"
    | "first_collection_created"
    | "first_page_published"
    | "daily_summary"
  >
>();
// Every code the existing error classifier returns is an installer code.
holds<Same<Exclude<ErrorCode, (typeof INSTALL_ERROR_CODES)[number]>, never>>();

// The accepted forms, so each refusal below differs from one of these by the
// one thing it names.
tools.capture("command_run", {
  command: "schema pull",
  alias: false,
  role: "local",
  exit_code: 0,
  duration_ms: 1200,
});
tools.capture("install_step", {
  section: "features",
  features: ["page_builder", "seo"],
});
site.capture("daily_summary", {
  database: "sqlite",
  collections: "1-10",
  singles: "0",
  published_documents: "11-100",
  plugins_official: ["@nextlyhq/plugin-seo"],
  plugins_other: 2,
});
site.capture("admin_first_opened", { heard_from: "search", run_by: "person" });

// An event the catalog does not list.
// @ts-expect-error TS2345
tools.capture("command_started", { command: "schema pull" });

// A site's event from the CLI.
// @ts-expect-error TS2345
tools.capture("first_page_published", {});

// The CLI's event from a site.
// @ts-expect-error TS2345
site.capture("command_run", {
  command: "schema pull",
  alias: false,
  role: "none",
});

// A property the event does not list: the old flag count.
tools.capture("command_run", {
  command: "dev",
  alias: false,
  role: "none",
  // @ts-expect-error TS2353
  flags_count: 2,
});

// A property the event does not list: the old hashed project id.
tools.capture("command_run", {
  command: "dev",
  alias: false,
  role: "none",
  // @ts-expect-error TS2353
  project_id: "abc",
});

// A base property, which only the session sets.
tools.capture("command_run", {
  command: "dev",
  alias: false,
  role: "none",
  // @ts-expect-error TS2353
  source: "site",
});

// A required property left out.
// @ts-expect-error TS2345
tools.capture("command_run", { command: "dev", role: "none" });

// A role that is not on the list.
// @ts-expect-error TS2322
tools.capture("command_run", { command: "dev", alias: false, role: "prod" });

// An exit code that is not on the list.
tools.capture("command_run", {
  command: "dev",
  alias: false,
  role: "none",
  // @ts-expect-error TS2322
  exit_code: 7,
});

// A feature that is not on the list.
tools.capture("install_step", {
  section: "features",
  // @ts-expect-error TS2322
  features: ["page_builder", "my-plugin"],
});

// An answer to "How did you hear?" that is not on the list.
// @ts-expect-error TS2322
site.capture("admin_first_opened", { heard_from: "google", run_by: "person" });

// An exact count where the summary takes a range.
site.capture("daily_summary", {
  database: "sqlite",
  // @ts-expect-error TS2322
  collections: 7,
  singles: "0",
  published_documents: "0",
  plugins_official: [],
  plugins_other: 0,
});
