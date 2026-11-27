import { afterEach, describe, expect, it, vi } from "vitest";

import { openSiteUsage, openToolsUsage } from "../index.js";

import {
  MACHINE_ID,
  SITE_ID,
  startReceiver,
  watchConnections,
} from "./usage-helpers.js";

// `NEXTLY_TELEMETRY_DEBUG=1` prints each event that would be sent, to
// standard error from the installer and the CLI and to the server log from a
// site, and sends nothing: the receiver stays empty and no connection opens.

const DEBUG = { NEXTLY_TELEMETRY_DEBUG: "1" };

afterEach(() => {
  vi.restoreAllMocks();
});

async function withReceiver(
  body: (endpoint: string) => Promise<void>
): Promise<{ received: number; connections: number }> {
  const receiver = await startReceiver();
  const connections = watchConnections();
  try {
    await body(receiver.endpoint);
    return {
      received: receiver.bodies.length,
      connections: connections.count(),
    };
  } finally {
    connections.stop();
    await receiver.close();
  }
}

describe("debug mode", () => {
  it.each(["installer", "cli"] as const)(
    "%s: prints each event to standard error and sends nothing",
    async source => {
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const stdout = vi.spyOn(process.stdout, "write");
      const fetchSpy = vi.fn(globalThis.fetch);

      const result = await withReceiver(async endpoint => {
        const session = openToolsUsage({
          source,
          nextlyVersion: "1.2.3",
          distinctId: MACHINE_ID,
          machineEnabled: true,
          env: DEBUG,
          endpoint,
          fetch: fetchSpy,
        });
        if (source === "installer") {
          session.capture("install_started", { from: "none", terminal: false });
          session.capture("install_failed", {
            step: "review",
            error_code: "cancelled",
            duration_ms: 9,
          });
        } else {
          session.capture("command_run", {
            command: "schema pull",
            alias: true,
            role: "local",
          });
        }
        await session.flush();
      });

      expect(result).toEqual({ received: 0, connections: 0 });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      const printed = stderr.mock.calls.map(([chunk]) => String(chunk));
      expect(printed).toHaveLength(source === "installer" ? 2 : 1);
      for (const line of printed) {
        expect(line).toMatch(/^nextly usage data \(debug, not sent\): \w+ \{/);
        expect(line).toContain(`"source":"${source}"`);
      }
    }
  );

  it("site: prints each event to the server log and sends nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchSpy = vi.fn(globalThis.fetch);

    const result = await withReceiver(async endpoint => {
      const session = openSiteUsage({
        nextlyVersion: "1.2.3",
        siteId: SITE_ID,
        role: "local",
        switchOn: true,
        env: DEBUG,
        endpoint,
        fetch: fetchSpy,
      });
      session.capture("daily_summary", {
        database: "postgresql",
        collections: "11-100",
        singles: "1-10",
        published_documents: "101-1000",
        plugins_official: ["@nextlyhq/plugin-page-builder"],
        plugins_other: 1,
      });
      await session.flush();
    });

    expect(result).toEqual({ received: 0, connections: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toMatch(
      /^nextly usage data \(debug, not sent\): daily_summary \{.*"plugins_other":1/
    );
  });

  it("prints only what would be sent: a dropped property is not shown", () => {
    const lines: string[] = [];
    const session = openToolsUsage({
      source: "cli",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env: DEBUG,
      debugWrite: line => lines.push(line),
    });
    session.capture("command_run", {
      command: "schema pull",
      alias: false,
      role: "none",
      error_code: "not a code",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("error_code");
  });

  it("prints nothing while usage data is off, since nothing would be sent", () => {
    const lines: string[] = [];
    const session = openToolsUsage({
      source: "cli",
      nextlyVersion: "1.2.3",
      distinctId: MACHINE_ID,
      machineEnabled: true,
      env: { ...DEBUG, CI: "1" },
      debugWrite: line => lines.push(line),
    });
    session.capture("command_run", {
      command: "schema pull",
      alias: false,
      role: "none",
    });
    expect(lines).toEqual([]);
  });
});
