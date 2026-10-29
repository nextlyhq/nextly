#!/usr/bin/env node
/**
 * `pnpm visual-check <route...>`: captures admin screens as a reader of a
 * pull request would see them, and reads each capture before a person does.
 *
 *   pnpm visual-check /admin /admin/collections/posts [--full] [--reuse | --keep] [--publish <topic>]
 *
 * It builds the playground for production and starts it on this checkout's
 * own port, seeded, as the production browser suite does; signs in as the
 * seeded user; and captures each route at 390, 1024 and 1440 px, light and
 * dark, as `<route>-<width>-<scheme>.png`. Each view is checked for sideways
 * scroll, elements past the right edge, and axe's serious and critical
 * violations. Every finding is printed, then the run exits non-zero if there
 * was any, or if a route answered 400 or more or was sent to sign-in.
 *
 * `--keep` leaves the server it started running, so later runs can pass
 * `--reuse` and skip the build; it prints how to stop it.
 *
 * `--unpublish <topic>` deletes that branch again, once a pull request is
 * merged or closed; `--help` prints the usage.
 *
 * `--publish <topic>` pushes the captures to `pr-screenshots/<topic>` and
 * prints a pull request's "The look" section.
 *
 * @module scripts/visual-check/run
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { signIn as signInThroughForm } from "../../e2e/tests/support/session.mjs";
import { isCliEntry } from "../cli-entry.mjs";

import { chromium, ROOT } from "./browser.mjs";
import { captureRoutes, sessionRenewer } from "./capture.mjs";
import { isPublicRoute } from "./page-checks.mjs";
import {
  capturePlan,
  parseOptions,
  prodPort,
  SCREENSHOT_BRANCHES,
  USAGE,
  UsageError,
} from "./options.mjs";
import { lookSection, publishCaptures, unpublishCaptures } from "./publish.mjs";
import { startProductionServer, stopCommand } from "./server.mjs";

/** Where captures go by default: beside the suite's own output, which git ignores. */
const DEFAULT_OUT = path.join(ROOT, "e2e", ".playwright", "visual-check");

/** This checkout's slot settings, which carry its ports; absent outside a slotted worktree. */
function slotSettings() {
  try {
    return JSON.parse(
      readFileSync(path.join(ROOT, ".claude", "settings.local.json"), "utf8")
    );
  } catch {
    return undefined;
  }
}

/**
 * Signs in as the seeded user through the sign-in form, as the production
 * suite does: a production server has no dev auto-login, and the suite's
 * helper fills the form only when told the server is a production one.
 */
async function signInAsSeededUser(baseURL, file) {
  process.env.E2E_SERVER = "production";
  await signInThroughForm(baseURL, file);
}

/**
 * The function a `--prepare` module exports by default, loaded before
 * anything is built or served, so a wrong path or a module with no such
 * function costs nothing to find out. No module, no function.
 */
async function loadPrepare(file) {
  if (file === undefined) return undefined;
  const resolved = path.resolve(file);
  let loaded;
  try {
    loaded = await import(pathToFileURL(resolved).href);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(`--prepare cannot load ${resolved}: ${said}`);
  }
  if (typeof loaded.default !== "function") {
    throw new Error(
      `--prepare ${resolved} has no default export function: export default async (page, { route, width, scheme }) => { … }`
    );
  }
  return loaded.default;
}

/**
 * Serves the playground (unless reusing one), signs in, and captures every
 * route into `outDir`. A server this started is stopped afterwards, or left
 * running with `--keep` and the command that stops it printed.
 */
async function serveAndCapture({
  options,
  port,
  outDir,
  startServer,
  signIn,
  log,
  drawnMs,
  prepare,
  now,
}) {
  const baseURL = `http://localhost:${port}`;
  // The session holds a live sign-in, so it is kept out of the capture folder
  // and removed after: on the way out of this function, and on an exit an
  // interrupt forces before that.
  const sessionDir = mkdtempSync(path.join(tmpdir(), "visual-check-session-"));
  const removeSession = () =>
    rmSync(sessionDir, { recursive: true, force: true });
  process.once("exit", removeSession);
  const storageState = path.join(sessionDir, "session.json");
  let server;
  try {
    if (!options.reuse) {
      server = await startServer({ port, keep: options.keep, log });
    }
    // Public screens are captured signed out, so a run of only those needs no
    // session; any other route is captured with one, renewed as it ages.
    let renew;
    if (!options.routes.every(isPublicRoute)) {
      await signIn(baseURL, storageState);
      renew = sessionRenewer({ baseURL, file: storageState, signIn, now });
    }
    const browser = await chromium.launch();
    try {
      return await captureRoutes({
        browser,
        baseURL,
        routes: options.routes,
        full: options.full,
        outDir,
        storageState,
        drawnMs,
        prepare,
        renew,
      });
    } finally {
      await browser.close();
    }
  } finally {
    process.off("exit", removeSession);
    removeSession();
    if (server && options.keep) {
      server.release();
      log(
        `The server is left running on ${baseURL}: pass --reuse to capture from it.`
      );
      log(`Stop it with: ${stopCommand(server.pid)}`);
    } else {
      await server?.stop();
    }
  }
}

/** Prints every finding, then every route not captured, then the counts. */
function report({ captures, failures, findings }, outDir, log) {
  for (const finding of findings) log(finding);
  for (const failure of failures) log(`Not captured: ${failure}`);
  log(
    `${captures.length} captures in ${outDir}; ${findings.length} findings; ${failures.length} routes not captured.`
  );
}

/**
 * Publishes the captures and prints the section that shows them, saying
 * whether it did; a refusal or a failed push is printed rather than thrown.
 */
async function publishAndPrint({
  captures,
  findings,
  topic,
  rawBase: givenRawBase,
  repoDir,
  publish,
  log,
}) {
  try {
    const { branch, rawBase } = await publish({
      cwd: repoDir,
      topic,
      rawBase: givenRawBase,
      files: captures.map(capture => capture.path),
    });
    log(`Published to ${branch}. Paste this into the pull request body:\n`);
    log(
      lookSection({
        rawBase,
        topic,
        files: captures.map(capture => capture.file),
        findings,
      })
    );
    return true;
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Why a run's captures may not be published, or null when they may.
 *
 * A route not captured always refuses it: the section would show part of the
 * change as the whole. Findings refuse it unless `allowFindings` says they
 * predate the change, and then the section lists them for the reviewer. Both
 * are decided before anything reaches the remote.
 */
function publishRefusal({ failures, findings }, allowFindings) {
  if (failures.length > 0) {
    return `Not published: ${failures.length} route(s) not captured. Fix them and capture again.`;
  }
  if (findings.length > 0 && !allowFindings) {
    return `Not published: ${findings.length} finding(s). Fix them and capture again, or pass --allow-findings if they predate this change, and they are listed with the captures.`;
  }
  return null;
}

/**
 * Deletes a published topic and says what was deleted: a teardown, so a
 * topic never published is said and is not a failure, and a failed delete is.
 */
async function unpublishAndSay({ topic, owner, repoDir, unpublish, log }) {
  const branch = `${SCREENSHOT_BRANCHES}${topic}`;
  try {
    const { deleted, source } = await unpublish({ cwd: repoDir, topic, owner });
    if (!deleted) log(`${branch} is not published: nothing to delete.`);
    else
      log(
        `Deleted ${branch}, published from ${source ?? "an unrecorded branch"}.`
      );
    return 0;
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * The run's options and `--prepare` function, or the exit code of a run that
 * ends here: a wrong invocation or a `--prepare` module that cannot be used
 * (2), `--help` (0), or `--unpublish`, which is a run of its own.
 */
async function setUp(argv, { log, repoDir, unpublish }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    log(`${error.message}\n${USAGE}`);
    return { code: 2 };
  }
  if (options.help) {
    log(USAGE);
    return { code: 0 };
  }
  if (options.unpublish !== undefined) {
    const code = await unpublishAndSay({
      topic: options.unpublish,
      owner: options.owner,
      repoDir,
      unpublish,
      log,
    });
    return { code };
  }
  try {
    return { options, prepare: await loadPrepare(options.prepare) };
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return { code: 2 };
  }
}

/**
 * Publishes the run's captures when `--publish` asked and the run allows it,
 * saying why not otherwise. Answers whether nothing went wrong: true too when
 * nothing was asked.
 */
async function publishIfAllowed(result, options, { repoDir, publish, log }) {
  if (options.publish === undefined) return true;
  const refusal = publishRefusal(result, options.allowFindings);
  if (refusal) {
    log(refusal);
    return false;
  }
  return publishAndPrint({
    captures: result.captures,
    findings: result.findings,
    topic: options.publish,
    rawBase: options.rawBase,
    repoDir,
    publish,
    log,
  });
}

/**
 * One run, from its arguments to its exit code: 0 when every route was
 * captured and nothing was found, 1 when anything failed or was found, 2 for
 * a wrong invocation.
 *
 * Starting the server, signing in and publishing are passed in so a test can
 * stand a stub server in for the built playground; everything else is the run.
 */
export async function visualCheck(argv, deps = {}) {
  const {
    env = process.env,
    log = line => console.log(line),
    startServer = startProductionServer,
    signIn = signInAsSeededUser,
    publish = publishCaptures,
    unpublish = unpublishCaptures,
    repoDir = ROOT,
    drawnMs,
    now,
  } = deps;

  const { code, options, prepare } = await setUp(argv, {
    log,
    repoDir,
    unpublish,
  });
  if (code !== undefined) return code;

  const outDir = path.resolve(options.out ?? DEFAULT_OUT);
  mkdirSync(outDir, { recursive: true });
  // This run's names only: a capture left from an earlier run must not pass for
  // one this run made, and nothing else in a chosen folder is this tool's to delete.
  for (const step of capturePlan(options.routes)) {
    rmSync(path.join(outDir, step.file), { force: true });
  }

  const result = await serveAndCapture({
    options,
    port: prodPort(env, slotSettings()),
    outDir,
    startServer,
    signIn,
    log,
    drawnMs,
    prepare,
    now,
  });
  report(result, outDir, log);

  const published = await publishIfAllowed(result, options, {
    repoDir,
    publish,
    log,
  });
  const clean = result.failures.length === 0 && result.findings.length === 0;
  return clean && published ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = await visualCheck(process.argv.slice(2));
}
