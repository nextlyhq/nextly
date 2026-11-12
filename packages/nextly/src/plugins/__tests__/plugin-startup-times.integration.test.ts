/**
 * A start names each plugin whose own start-up code (`init` and `onReady`) took longer than
 * 500 ms, with its time, and does not name a fast one.
 *
 * Two fixture plugins boot together: one whose `init` and `onReady` wait 300 ms each, 600 ms in
 * all, so it is over the line only when both hooks are counted, and one that returns at once.
 * The warning comes through the logger the configuration supplies.
 */
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import { SLOW_PLUGIN_STARTUP_MS } from "../plugin-startup-times";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

const slow = definePlugin({
  name: "@test/slow-start",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: () => wait(300),
  onReady: () => wait(300),
});

const fast = definePlugin({
  name: "@test/fast-start",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: () => undefined,
  onReady: () => undefined,
});

/** A logger that keeps every line. */
function keepingLogger() {
  const lines: { level: string; message: string }[] = [];
  const keep = (level: string) => (message: unknown) => {
    lines.push({ level, message: String(message) });
  };
  return {
    lines,
    logger: {
      debug: keep("debug"),
      info: keep("info"),
      warn: keep("warn"),
      error: keep("error"),
    },
  };
}

describe("plugin start-up times", () => {
  it("names a plugin over 500 ms with its time, and not a fast one", async () => {
    const { lines, logger } = keepingLogger();

    current = await createTestNextly({ plugins: [slow, fast], logger });

    const warnings = lines.filter(
      line =>
        line.level === "warn" &&
        line.message.includes(`longer than ${SLOW_PLUGIN_STARTUP_MS} ms`)
    );
    expect(warnings).toHaveLength(1);
    const [warning] = warnings;
    const named = /"@test\/slow-start" (\d+) ms/.exec(warning.message);
    expect(named, warning.message).not.toBeNull();
    // Both hooks counted: each alone is under the line.
    expect(Number(named?.[1])).toBeGreaterThanOrEqual(600);
    expect(warning.message).not.toContain("@test/fast-start");
  });

  it("names nothing when every plugin starts fast", async () => {
    const { lines, logger } = keepingLogger();

    current = await createTestNextly({ plugins: [fast], logger });

    expect(
      lines.filter(line =>
        line.message.includes(`longer than ${SLOW_PLUGIN_STARTUP_MS} ms`)
      )
    ).toEqual([]);
    // Its time is still logged, at debug level.
    expect(
      lines.some(
        line =>
          line.level === "debug" &&
          /Plugin start-up times: "@test\/fast-start" \d+ ms/.test(line.message)
      )
    ).toBe(true);
  });
});
