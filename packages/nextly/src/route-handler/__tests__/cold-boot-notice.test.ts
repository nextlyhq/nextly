/**
 * What the cold-boot notice says, in each situation it can fire in.
 *
 * The notice reports what the process observed, never an absence it inferred:
 * when no server-start start ran it may offer the instrumentation file as
 * conditional guidance, but must not claim the file was detected missing;
 * when the project's instrumentation started Nextly it must say the request
 * arrived before Nextly finished starting, claim nothing beyond that, and
 * not mention the file at all. A boot another request began through
 * request-time `getNextly({ config })` is not a server-start start, so the
 * guidance variant is what it hears. All variants stay behind the
 * development and suppression gates. The wordings are asserted as substrings,
 * and the gates are pinned from the logging side: each variant test asserts
 * the spy was written to, so a gate test that logs nothing is the gate
 * working rather than a spy that never fires.
 */
import { afterEach, expect, it, vi } from "vitest";

const warn = vi.fn();
const isServerStartRegisterRunning = vi.fn(() => false);

vi.mock("../../init", () => ({ isServerStartRegisterRunning }));
vi.mock("../../shared/types", async importOriginal => ({
  ...(await importOriginal<typeof import("../../shared/types")>()),
  consoleLogger: { warn },
}));

const { warnColdBootNotice } = await import("../cold-boot-notice");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  isServerStartRegisterRunning.mockReturnValue(false);
});

it("says no start was observed, with the file advice conditional, when no server-start start ran", () => {
  vi.stubEnv("NODE_ENV", "development");
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  isServerStartRegisterRunning.mockReturnValue(false);

  warnColdBootNotice();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = warn.mock.calls[0][0] as string;
  // What the process observed, not what the project contains.
  expect(message).toContain("no start was observed in this process");
  // The advice is conditional guidance for a project with no start, and the
  // suppression variable's mention stays.
  expect(message).toContain("If nothing starts Nextly when your server starts");
  expect(message).toContain("NEXTLY_DISABLE_INSTRUMENTATION_WARNING=1");
  // The old wording asserted a detection that never happened; this notice
  // must not assert any.
  expect(message).not.toContain("detected");
});

it("keeps the conditional guidance when the only boot in flight is one another request began", () => {
  vi.stubEnv("NODE_ENV", "development");
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  // Request-time getNextly({ config }): in flight, but no server-start
  // register ever ran in this process.
  isServerStartRegisterRunning.mockReturnValue(false);

  warnColdBootNotice();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = warn.mock.calls[0][0] as string;
  expect(message).toContain("no start was observed in this process");
  expect(message).toContain("If nothing starts Nextly when your server starts");
  expect(message).not.toContain("before Nextly finished starting");
});

it("says the request arrived before Nextly finished starting once the project's instrumentation start is running, claiming nothing further", () => {
  vi.stubEnv("NODE_ENV", "development");
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  isServerStartRegisterRunning.mockReturnValue(true);

  warnColdBootNotice();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = warn.mock.calls[0][0] as string;
  expect(message).toContain("before Nextly finished starting");
  // No detected-missing claim and no add-the-file advice: the start the
  // request raced is the one the advice would tell the reader to add. And
  // no claim in the other direction either — the observed start says
  // nothing about what the project does or does not contain, or about
  // where the work runs.
  expect(message).not.toContain("instrumentation.ts");
  expect(message).not.toContain("Nothing is missing");
  expect(message).not.toContain("warmup");
});

it("logs neither variant under the suppression variable", () => {
  vi.stubEnv("NODE_ENV", "development");
  process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING = "1";

  warnColdBootNotice();
  isServerStartRegisterRunning.mockReturnValue(true);
  warnColdBootNotice();

  expect(warn).not.toHaveBeenCalled();
});

it("logs neither variant outside development", () => {
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  vi.stubEnv("NODE_ENV", "production");

  warnColdBootNotice();
  isServerStartRegisterRunning.mockReturnValue(true);
  warnColdBootNotice();

  expect(warn).not.toHaveBeenCalled();
});
