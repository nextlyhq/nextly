import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KILL_AT_VARIABLE,
  reachStopPoint,
  withStopPoints,
} from "../stop-points";

afterEach(() => {
  vi.restoreAllMocks();
});

/** `process.kill`, watched and kept from killing the test's own process. */
const watchKill = () =>
  vi.spyOn(process, "kill").mockImplementation(() => true);

describe("a stop point", () => {
  it("kills the process at the point the variable names, under test", async () => {
    const kill = watchKill();
    await reachStopPoint("removed fieldGroupValues", {
      NODE_ENV: "test",
      [KILL_AT_VARIABLE]: "removed fieldGroupValues",
    });
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGKILL");
  });

  it("ignores the variable unless NODE_ENV is test, so it never stops a production run", async () => {
    const kill = watchKill();
    for (const NODE_ENV of ["production", "development", undefined]) {
      await reachStopPoint("removed fieldGroupValues", {
        ...(NODE_ENV === undefined ? {} : { NODE_ENV }),
        [KILL_AT_VARIABLE]: "removed fieldGroupValues",
      });
    }
    expect(kill).not.toHaveBeenCalled();
  });

  it("kills the process at no other point", async () => {
    const kill = watchKill();
    await reachStopPoint("removed translationArchive", {
      NODE_ENV: "test",
      [KILL_AT_VARIABLE]: "removed fieldGroupValues",
    });
    expect(kill).not.toHaveBeenCalled();
  });

  it("runs the run's own hook, only while that run lasts", async () => {
    const reached: string[] = [];
    await withStopPoints(
      point => {
        reached.push(point);
      },
      () => reachStopPoint("inside", {})
    );
    await reachStopPoint("after", {});
    expect(reached).toEqual(["inside"]);
  });

  it("fails the run at the point a hook throws", async () => {
    await expect(
      withStopPoints(
        point => {
          if (point === "there") throw new Error("stopped there");
        },
        async () => {
          await reachStopPoint("before", {});
          await reachStopPoint("there", {});
        }
      )
    ).rejects.toThrow("stopped there");
  });
});
