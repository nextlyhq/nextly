/**
 * A command's notice at each try for a busy table goes to standard error, so a `--json` run keeps
 * one document on standard output, and is kept back under `--quiet`, which shows errors only. The
 * stop itself is an error, reported through the logger, so `--quiet` still shows it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { busyTableNotices } from "../busy-table-options";
import { createLogger } from "../utils/logger";

describe("a command's busy-table try notices", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("go to standard error", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    busyTableNotices(createLogger())("posts: try 2 of up to 7.");
    expect(write).toHaveBeenCalledWith("posts: try 2 of up to 7.\n");
  });

  it("are kept back under --quiet", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    busyTableNotices(createLogger({ quiet: true }))("posts: try 2 of up to 7.");
    expect(write).not.toHaveBeenCalled();
  });

  it("follow --quiet as the logger has it when the notice is sent", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const logger = createLogger();
    const notify = busyTableNotices(logger);
    logger.setOptions({ quiet: true });
    notify("posts: try 2 of up to 7.");
    expect(write).not.toHaveBeenCalled();
  });
});
