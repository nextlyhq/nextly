/**
 * A production start that finds `admin.branding.showBuilder: true` says once that the setting has
 * no effect there and that schema reaches production through migrations.
 *
 * Asserted through `registerServices`, the start every production boot passes through, rather
 * than through the notice's own function: what is under test is that the start says it, once,
 * and the function's own cases are in `shared/__tests__/builder-access.test.ts`.
 *
 * The adapter here cannot connect, so each start fails after its once-per-start warnings and
 * before anything reaches a database: the line is logged by a start that has written nothing.
 * The controls are the starts that must NOT say it — development with the flag on, production
 * with it unset or false — so a notice logged on every start, or on none, fails here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices } = await import("../register");

/** An adapter that fails after the start's warnings are logged. */
const failingAdapter = { connect: () => undefined };

/** Every line the start logged as a warning. */
async function warningsOfStart(
  nodeEnv: "production" | "development",
  showBuilder: boolean | undefined
): Promise<string[]> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  const warn = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
  };
  await registerServices({
    adapter: failingAdapter,
    logger,
    admin: showBuilder === undefined ? {} : { branding: { showBuilder } },
  } as unknown as Parameters<typeof registerServices>[0]).catch(() => {});
  return warn.mock.calls.map(call => String(call[0]));
}

const aboutTheBuilder = (lines: string[]) =>
  lines.filter(line => line.includes("showBuilder"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the start's word on showBuilder", () => {
  it("is said once by a production start that finds showBuilder: true", async () => {
    const lines = aboutTheBuilder(await warningsOfStart("production", true));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("no effect in production");
    expect(lines[0]).toContain("migrations");
  });

  it.each([
    ["a development start with showBuilder: true", "development", true],
    ["a production start with showBuilder unset", "production", undefined],
    ["a production start with showBuilder: false", "production", false],
  ] as const)("is not said by %s", async (_label, nodeEnv, showBuilder) => {
    expect(
      aboutTheBuilder(await warningsOfStart(nodeEnv, showBuilder))
    ).toEqual([]);
  });
});
