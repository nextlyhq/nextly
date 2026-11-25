import { describe, expect, it } from "vitest";

import { NextlyError } from "../nextly-error";

describe("NextlyError.configuration", () => {
  it("keeps the failure under it, behind the same generic message", () => {
    const cause = new Error("EACCES: permission denied");
    const error = NextlyError.configuration({
      logMessage: "The folder cannot be listed.",
      cause,
    });
    expect(error.cause).toBe(cause);
    expect(error.code).toBe("CONFIGURATION_ERROR");
    expect(error.publicMessage).toBe("Server configuration error.");
  });

  it("has none where it is given none", () => {
    expect(
      NextlyError.configuration({ logMessage: "No config." }).cause
    ).toBeUndefined();
  });
});
