/**
 * nextly dev - Wrapper CLI
 *
 * Spawns `next dev` as a child process and owns:
 * - Terminal and stdin (for @clack/prompts when code-first changes happen)
 * - File watcher on nextly.config.ts
 * - Authoritative config loading via jiti (plain Node, bundler-independent)
 * - DDL execution via drizzle-kit/api (works reliably in plain Node)
 * - HTTP IPC with the child over loopback for bidirectional coordination
 *
 * This Sub-task 3 implementation is a skeleton: it spawns next dev, waits for
 * readiness via /__nextly/health, loads the config once, and watches for
 * changes (logging only). Sub-task 4 wires @clack/prompts into the change
 * flow. Sub-task 5 wires UI-first apply-requests.
 *
 * @module cli/commands/dev
 * @since Task 11
 */

import type { Command } from "commander";

import { runDbSync } from "../commands/db-sync.js";
import { createContext, type GlobalOptions } from "../program.js";
import { createAdapter, validateDatabaseEnv } from "../utils/adapter.js";
import {
  createApplyServices,
  executeApplyRequest,
  type ApplyServices,
} from "../wrapper/apply-executor.js";
import { buildNextDevSupervisorOptions } from "../wrapper/build-next-dev-supervisor-options.js";
import { loadNextlyConfig } from "../wrapper/config-loader.js";
import { FileWatcher } from "../wrapper/file-watcher.js";
import { findFreePort } from "../wrapper/free-port.js";
import { IpcClient } from "../wrapper/ipc-client.js";
import { generateIpcToken } from "../wrapper/ipc-token.js";
import { NextBinaryNotFoundError } from "../wrapper/resolve-next-bin.js";
import { Supervisor } from "../wrapper/supervisor.js";

export interface DevWrapperCommandOptions {
  port?: string;
  turbopack?: boolean;
}

// Polls /__nextly/health until the child responds or the timeout elapses.
// Why as helper: lets the caller proceed safely after next dev is ready
// to accept IPC requests, avoiding race conditions where the wrapper tries
// to POST /pending before the child server has bound its listener.
//
// Nextly's IPC server is bound lazily inside getNextly(), which only runs
// on the first HTTP request to Next. We poke the child's root URL to warm
// it up so the IPC server binds even before the user opens a browser.
async function waitForChildReady(
  ipcClient: IpcClient,
  childPort: string,
  timeoutMs = 60_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  // Fire-and-forget warm-up request. Success / failure does not matter
  // here - we just need SOME request to hit the Next.js server so its
  // initialization pipeline runs and Nextly's IPC server binds.
  const warmUp = async () => {
    // Nextly's IPC server is bound lazily inside getNextly(). We have to
    // hit a route the Nextly route handler owns (under /admin/api) rather
    // than a plain Next page like /, because the route handler is the
    // only entry that calls getNextly(). Any /admin/api/* works; we use
    // admin-meta because it is unauthenticated, GET-friendly, and cheap.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      await fetch(`http://127.0.0.1:${childPort}/admin/api/admin-meta`, {
        signal: controller.signal,
      }).catch(() => undefined);
      clearTimeout(timer);
    } catch {
      // Swallow; next loop tick retries.
    }
  };

  // Kick off an immediate warm-up so the first health check does not race
  // with a cold child. Subsequent ticks re-poke every 3 seconds until the
  // IPC server is confirmed up.
  void warmUp();
  let lastWarmUpAt = Date.now();

  while (Date.now() < deadline) {
    if (await ipcClient.healthCheck()) return true;
    if (Date.now() - lastWarmUpAt > 3000) {
      void warmUp();
      lastWarmUpAt = Date.now();
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

export function registerDevCommand(program: Command): void {
  program
    .command("dev")
    .description(
      "Start the Nextly dev wrapper. Spawns next dev and handles schema change prompts + restarts."
    )
    .option("-p, --port <port>", "Port for next dev", "3000")
    .action(async (cmdOptions: DevWrapperCommandOptions, cmd: Command) => {
      const globalOpts: GlobalOptions = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      const { logger } = context;
      const cwd = globalOpts.cwd ?? process.cwd();

      // Token + port shared with the child via env vars. The child's
      // Nextly init reads these and starts an IPC server bound to
      // 127.0.0.1:<port>. All wrapper <-> child coordination flows through
      // that server, NOT through Next's dev server port. Keeps IPC off the
      // user's app route surface entirely.
      const ipcToken = generateIpcToken();
      let ipcPort: number;
      try {
        ipcPort = await findFreePort();
      } catch (err) {
        logger.error(
          `Could not find a free loopback port for IPC: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }

      // Resolve next's JS entry in the user's project and spawn `node` on
      // it directly. Avoids `npx` (a platform-specific shim: `npx` on POSIX,
      // `npx.cmd` on Windows) that Node's child_process spawn cannot
      // reliably locate without shell lookup. Running process.execPath +
      // absolute JS path behaves identically on every OS.
      let supervisor: Supervisor;
      try {
        supervisor = new Supervisor(
          buildNextDevSupervisorOptions({
            cwd,
            port: cmdOptions.port ?? "3000",
            env: {
              ...process.env,
              NEXTLY_IPC_TOKEN: ipcToken,
              NEXTLY_IPC_PORT: String(ipcPort),
            },
            onExit: (code, signal) => {
              logger.warn(
                `next dev exited unexpectedly (code=${code}, signal=${signal}).`
              );
              logger.info(
                "Fix the error and save a file to respawn. Ctrl+C to exit."
              );
            },
          })
        );
      } catch (err) {
        if (err instanceof NextBinaryNotFoundError) {
          logger.error(err.message);
          process.exit(1);
        }
        throw err;
      }

      const ipcClient = new IpcClient({
        baseUrl: `http://127.0.0.1:${ipcPort}`,
        token: ipcToken,
      });

      // Auto-initialize the database before spawning next dev so a fresh
      // project "just works" with a single `nextly dev` command. Without
      // this, the first request after `create-nextly-app` would hit
      // `no such table: dynamic_singles` / `dynamic_collections` because
      // the user has not run `nextly db:sync` yet. Skipped if DATABASE_URL
      // is missing (users with no DB yet can still start the wrapper) or
      // if NEXTLY_SKIP_AUTO_SYNC=1 is set (escape hatch for shared dev
      // DBs where you don't want implicit schema sync at every dev start).
      // runDbSync is idempotent: tables are created with IF NOT EXISTS
      // via drizzle-kit, seeding skips already-present rows.
      const dbEnv = validateDatabaseEnv();
      if (dbEnv.valid && process.env.NEXTLY_SKIP_AUTO_SYNC !== "1") {
        try {
          logger.info("Initializing database (first run or re-sync)...");
          await runDbSync(
            {
              // Create system tables + sync collections to DB. Idempotent.
              autoSync: true,
              // Seed permissions + demo content if nextly.seed.ts exists.
              // Safe on re-runs; seeders skip existing rows.
              seed: true,
              cwd,
              // Silence the big banner + verbose output - we're running
              // this implicitly and don't want to clutter `nextly dev`.
              quiet: true,
            },
            context
          );
        } catch (err) {
          // Don't kill the wrapper if init fails - users can still hit
          // /admin/setup, or run `nextly db:sync` manually. Surface the
          // error loudly so they know what to do.
          logger.warn(
            `Auto-init failed: ${err instanceof Error ? err.message : String(err)}`
          );
          logger.info(
            "Continuing startup. Run `npx nextly db:sync --seed` manually to retry."
          );
        }
      }

      logger.info("Starting next dev...");
      await supervisor.start();

      // Wait for child readiness before hooking the file watcher. Without
      // this, an immediate config change would hit a cold IPC endpoint and
      // require retry/backoff.
      const ready = await waitForChildReady(
        ipcClient,
        cmdOptions.port ?? "3000"
      );
      if (!ready) {
        logger.warn(
          "next dev did not respond to IPC health checks within 60s. Continuing without verified readiness."
        );
      } else {
        logger.info(`IPC server ready on port ${ipcPort}`);
      }

      // Authoritative config load in the wrapper's plain-Node context.
      let initialConfigPath: string;
      try {
        const { configPath } = await loadNextlyConfig(cwd);
        initialConfigPath = configPath;
        logger.info(`Loaded config from ${configPath}`);
      } catch (err) {
        logger.error(
          `Failed to load nextly config: ${err instanceof Error ? err.message : String(err)}`
        );
        await supervisor.stop();
        process.exit(1);
      }

      // Build the apply services up-front so every UI-first apply request
      // reuses the same adapter + registry + SchemaChangeService. Lazy
      // because we only need it when the user is running a wrapper-mode
      // dev session with DATABASE_URL configured; lazy init also means the
      // wrapper does not fail fast on missing DB env and instead surfaces
      // a clear error only when an apply is actually attempted.
      let applyServices: ApplyServices | null = null;
      const getApplyServices = async (): Promise<ApplyServices | null> => {
        if (applyServices) return applyServices;
        const env = validateDatabaseEnv();
        if (!env.valid) {
          logger.warn(
            `Apply services unavailable: ${env.errors.join("; ")}. UI-first applies will fail until DATABASE_URL is set.`
          );
          return null;
        }
        const adapter = await createAdapter({ logger });
        applyServices = createApplyServices(adapter, {
          info: (msg: string) => logger.debug(msg),
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
          debug: (msg: string) => logger.debug(msg),
        });
        return applyServices;
      };

      // F1 PR 2: code-first dispatch moved to runtime/hmr-listener.ts.
      // The wrapper's onChange path used to invoke the change orchestrator
      // (which prompted the user, applied DDL, and restarted the child).
      // With single-process F1, the child receives Next's HMR event itself
      // and getNextly() drains the reload flag in-process. The wrapper
      // still spawns and supervises the child for now (PR 4 deletes the
      // whole wrapper directory); we just no-op the onChange callback so
      // the wrapper does not race with the in-process listener.
      const watcher = new FileWatcher({
        path: initialConfigPath,
        debounceMs: 500,
        onChange: async hash => {
          logger.debug(
            `Config change detected (hash=${hash.slice(0, 8)}...) - ` +
              `dispatch handled by in-process HMR listener (F1 PR 2)`
          );
          // No-op: the in-process HMR listener now handles this.
          await Promise.resolve();
        },
        onError: err => {
          logger.warn(
            `File watcher error: ${err instanceof Error ? err.message : String(err)}`
          );
        },
      });
      await watcher.start();
      logger.info(
        `Watching ${initialConfigPath} for changes (handled by in-process HMR listener)`
      );

      // Poll the child's IPC dispatcher for UI-first apply requests. When
      // admin UI submits a schema apply, the child's collection-dispatcher
      // enqueues it; the wrapper picks it up here, runs DDL via
      // SchemaChangeService (plain Node context where drizzle-kit/api
      // works), posts the result back so the admin endpoint can resolve,
      // then respawns next dev so runtime picks up the new schema.
      const applyPollIntervalMs = 500;
      const startApplyPolling = () => {
        const tick = async () => {
          if (shuttingDown) return;
          try {
            const requests = await ipcClient.getApplyRequests();
            for (const req of requests) {
              logger.info(
                `UI-first apply request for '${req.slug}' (id=${req.id})`
              );
              const services = await getApplyServices();
              if (!services) {
                await ipcClient
                  .postApplyResult({
                    id: req.id,
                    success: false,
                    error:
                      "Wrapper could not initialize apply services. Check DATABASE_URL.",
                  })
                  .catch(() => {});
                continue;
              }

              let result;
              try {
                result = await executeApplyRequest(services, {
                  slug: req.slug,
                  newFields: req.newFields,
                  resolutions: req.resolutions,
                });
              } catch (execErr) {
                // executeApplyRequest has its own try/catch now, but add a
                // belt-and-suspenders here so any unexpected throw during
                // result posting does not leave the admin dialog hanging.
                const msg =
                  execErr instanceof Error ? execErr.message : String(execErr);
                logger.error(
                  `executeApplyRequest unexpected throw for '${req.slug}': ${msg}`
                );
                await ipcClient
                  .postApplyResult({
                    id: req.id,
                    success: false,
                    error: msg,
                  })
                  .catch(() => {});
                continue;
              }

              // Post the result so the admin endpoint can resolve the
              // long-polled pushApplyRequest promise BEFORE we respawn
              // the child; if we restart first, the admin's request loses
              // its server connection and retries.
              await ipcClient
                .postApplyResult({
                  id: req.id,
                  success: result.success,
                  newSchemaVersion: result.newSchemaVersion,
                  error: result.error,
                })
                .catch(() => {});

              if (result.success) {
                logger.info(
                  `Applied '${req.slug}'. Restarting dev server to surface the new schema...`
                );
                // Fire and forget: the child restart takes ~2-3s but we
                // want the poll loop to keep running so subsequent
                // requests (rare but possible) are picked up promptly.
                void supervisor.restart().catch(err => {
                  logger.error(
                    `Restart failed after apply: ${err instanceof Error ? err.message : String(err)}`
                  );
                });
              } else {
                logger.error(
                  `Apply failed for '${req.slug}': ${result.error ?? result.message ?? "unknown error"}`
                );
              }
            }
          } catch {
            // Poll errors are transient (child restart in progress, etc.).
            // Next tick retries.
          }
        };
        const handle = setInterval(() => void tick(), applyPollIntervalMs);
        handle.unref();
        return handle;
      };

      // Graceful shutdown: clean up watcher + child on Ctrl+C or SIGTERM.
      // Why first call exits in-place: on first SIGINT we give supervisor a
      // chance to SIGTERM the child and wait for exit. On second SIGINT
      // (emergency) Node's default handler kills us hard.
      let shuttingDown = false;
      const applyPollHandle = startApplyPolling();
      const handleShutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`Received ${signal}, shutting down...`);
        clearInterval(applyPollHandle);
        await watcher.stop();
        await supervisor.stop();
        process.exit(0);
      };
      process.on("SIGINT", () => void handleShutdown("SIGINT"));
      process.on("SIGTERM", () => void handleShutdown("SIGTERM"));
    });
}
