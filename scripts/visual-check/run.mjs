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
 * `--publish <topic>` pushes the captures to `pr-screenshots/<topic>` and
 * prints a pull request's "The look" section.
 *
 * @module scripts/visual-check/run
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { signIn as signInThroughForm } from "../../e2e/tests/support/session.ts";
import { isCliEntry } from "../cli-entry.mjs";

import { chromium, ROOT } from "./browser.mjs";
import { captureRoutes } from "./capture.mjs";
import {
  capturePlan,
  parseOptions,
  prodPort,
  USAGE,
  UsageError,
} from "./options.mjs";
import { lookSection, publishCaptures } from "./publish.mjs";
import { startProductionServer } from "./server.mjs";

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
}) {
  const baseURL = `http://localhost:${port}`;
  // The session holds a live sign-in, so it is kept out of the capture folder and removed after.
  const sessionDir = mkdtempSync(path.join(tmpdir(), "visual-check-session-"));
  const storageState = path.join(sessionDir, "session.json");
  const server = options.reuse ? undefined : await startServer({ port, log });
  try {
    await signIn(baseURL, storageState);
    const browser = await chromium.launch();
    try {
      return await captureRoutes({
        browser,
        baseURL,
        routes: options.routes,
        full: options.full,
        outDir,
        storageState,
      });
    } finally {
      await browser.close();
    }
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
    if (server && options.keep) {
      server.release();
      log(
        `The server is left running on ${baseURL}: pass --reuse to capture from it.`
      );
      log(`Stop it with: kill -TERM -${server.pid}`);
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
async function publishAndPrint({ captures, topic, repoDir, publish, log }) {
  try {
    const { branch, rawBase } = await publish({
      cwd: repoDir,
      topic,
      files: captures.map(capture => capture.path),
    });
    log(`Published to ${branch}. Paste this into the pull request body:\n`);
    log(
      lookSection({
        rawBase,
        topic,
        files: captures.map(capture => capture.file),
      })
    );
    return true;
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return false;
  }
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
    repoDir = ROOT,
  } = deps;

  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    log(`${error.message}\n${USAGE}`);
    return 2;
  }

  const outDir = path.resolve(options.out ?? DEFAULT_OUT);
  mkdirSync(outDir, { recursive: true });
  // This run's names only: a capture left from an earlier run must not pass for
  // one this run made, and nothing else in a chosen folder is this tool's to delete.
  for (const step of capturePlan(options.routes)) {
    rmSync(path.join(outDir, step.file), { force: true });
  }

  const port = prodPort(env, slotSettings());
  const result = await serveAndCapture({
    options,
    port,
    outDir,
    startServer,
    signIn,
    log,
  });
  report(result, outDir, log);

  const published =
    options.publish === undefined ||
    result.captures.length === 0 ||
    (await publishAndPrint({
      captures: result.captures,
      topic: options.publish,
      repoDir,
      publish,
      log,
    }));
  const clean = result.failures.length === 0 && result.findings.length === 0;
  return clean && published ? 0 : 1;
}

if (isCliEntry(import.meta.url)) {
  process.exitCode = await visualCheck(process.argv.slice(2));
}
