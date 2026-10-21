/**
 * What the cold-boot notice says, in each situation it can fire in.
 *
 * The notice reports what the process observed, never an absence it inferred:
 * when no start was under way it may offer the instrumentation file as
 * conditional guidance, but must not claim the file was detected missing; when
 * a start was under way it must say the request arrived before Nextly finished
 * starting and not mention the file at all. Both variants stay behind the
 * development and suppression gates. The wordings are asserted as substrings,
 * and the gates are pinned from the logging side: each variant test asserts
 * the spy was written to, so a gate test that logs nothing is the gate working
 * rather than a spy that never fires.
 */
import { afterEach, expect, it, vi } from "vitest";

const warn = vi.fn();
const isNextlyStartInFlight = vi.fn(() => false);

vi.mock("../../init", () => ({ isNextlyStartInFlight }));
vi.mock("../../shared/types", async importOriginal => ({
  ...(await importOriginal<typeof import("../../shared/types")>()),
  consoleLogger: { warn },
}));

const { warnColdBootNotice } = await import("../cold-boot-notice");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  isNextlyStartInFlight.mockReturnValue(false);
});

it("says no start was observed, with the file advice conditional, when nothing was in flight", () => {
  vi.stubEnv("NODE_ENV", "development");
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  isNextlyStartInFlight.mockReturnValue(false);

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

it("says the request arrived before Nextly finished starting while a start is in flight, without the file advice", () => {
  vi.stubEnv("NODE_ENV", "development");
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  isNextlyStartInFlight.mockReturnValue(true);

  warnColdBootNotice();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = warn.mock.calls[0][0] as string;
  expect(message).toContain("before Nextly finished starting");
  // No detected-missing claim and no add-the-file advice: the start the
  // request raced is the one the advice would tell the reader to add.
  expect(message).not.toContain("instrumentation.ts");
});

it("logs neither variant under the suppression variable", () => {
  vi.stubEnv("NODE_ENV", "development");
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING = "1";

  warnColdBootNotice();
  isNextlyStartInFlight.mockReturnValue(true);
  warnColdBootNotice();

  expect(warn).not.toHaveBeenCalled();
});

it("logs neither variant outside development", () => {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  delete process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING;
  vi.stubEnv("NODE_ENV", "production");

  warnColdBootNotice();
  isNextlyStartInFlight.mockReturnValue(true);
  warnColdBootNotice();

  expect(warn).not.toHaveBeenCalled();
});
