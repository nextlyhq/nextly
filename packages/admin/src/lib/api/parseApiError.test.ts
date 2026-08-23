/**
 * Turning a failed request into something worth reading.
 *
 * A validation failure's top-level message is "Validation failed." — true, and
 * useless. The reasons are per-field in `data.errors`, so showing the message
 * alone tells someone their form was rejected without saying by what.
 */
import { describe, expect, it } from "vitest";

import {
  apiErrorMessage,
  isApiError,
  normalizeValidationIssues,
  parseApiError,
  validationIssues,
} from "./parseApiError";

const validationBody = (
  errors: Array<{ path?: string; code?: string; message?: string }>
) => ({
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed.",
    requestId: "req_x",
    data: { errors },
  },
});

describe("parseApiError", () => {
  it("reads the canonical shape", () => {
    const err = parseApiError(
      { error: { code: "NOT_FOUND", message: "Not found.", requestId: "r1" } },
      404
    );

    expect(err.message).toBe("Not found.");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.requestId).toBe("r1");
  });

  it("keeps the validation payload", () => {
    const err = parseApiError(
      validationBody([{ path: "name", code: "REQUIRED", message: "Need it." }]),
      400
    );

    expect(err.data?.errors).toHaveLength(1);
  });

  it("falls through when the shape is not canonical", () => {
    const err = parseApiError({ oops: true }, 500);

    expect(err.code).toBe("UNKNOWN");
  });
});

describe("isApiError", () => {
  it("says yes to what the fetcher raises for a refused request", () => {
    expect(isApiError(parseApiError(validationBody([]), 400))).toBe(true);
  });

  // The case the guard exists for. `fetcher` awaits `fetch` without wrapping
  // it, so going offline rejects with this and never reaches `parseApiError`.
  // Anything that read `status` off a rejection would find `undefined` under a
  // type that promises a number.
  it("says NO to the native error a dead network rejects with", () => {
    expect(isApiError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("says no when status is present but not a number", () => {
    // A truthiness check, or `"status" in reason`, would pass this.
    const wrong = Object.assign(new Error("odd"), { status: "400" });

    expect(isApiError(wrong)).toBe(false);
  });

  it("says no to values that are not errors at all", () => {
    expect(isApiError({ status: 400 })).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });

  // This narrows `unknown` across the published SDK boundary, so a numeric
  // `status` alone is not proof of the shape: another client's error that
  // records one would be handed to a plugin author as an `ApiError` whose
  // `code` is declared `string` and is not.
  describe("a present field of the wrong type", () => {
    it.each([
      ["code", { status: 400, code: 42 }],
      ["requestId", { status: 400, requestId: 7 }],
      ["data", { status: 400, data: "not an object" }],
    ])("rejects a wrong %s", (_field, extra) => {
      expect(isApiError(Object.assign(new Error("x"), extra))).toBe(false);
    });

    it("still accepts them absent, because the type says optional", () => {
      expect(isApiError(Object.assign(new Error("x"), { status: 400 }))).toBe(
        true
      );
    });
  });
});

describe("normalizeValidationIssues", () => {
  // The blankness rule lives HERE and nowhere else, so a consumer keying by
  // field and a consumer showing a sentence cannot disagree about whether ""
  // counts as a message.
  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("reports %s as absent rather than carrying it", (_name, message) => {
    expect(normalizeValidationIssues([{ path: "name", message }])).toEqual([
      { path: "name", code: undefined, message: undefined },
    ]);
  });

  it("keeps a message that merely has surrounding space", () => {
    // Blank is absent; padded is not. Trimming the retained value would be a
    // separate decision about presentation.
    expect(
      normalizeValidationIssues([{ path: "name", message: " Need it. " }])
    ).toEqual([{ path: "name", code: undefined, message: " Need it. " }]);
  });
});

describe("validationIssues", () => {
  it("hands back what the server said, field by field", () => {
    const err = parseApiError(
      validationBody([
        { path: "name", code: "REQUIRED", message: "A role needs a name." },
      ]),
      400
    );

    expect(validationIssues(err)).toEqual([
      { path: "name", code: "REQUIRED", message: "A role needs a name." },
    ]);
  });

  // A consumer keying by field gets an array either way, so "not a validation
  // failure" needs no separate branch anywhere that calls this.
  it("is empty for a transport failure, which carries no payload", () => {
    expect(validationIssues(new TypeError("Failed to fetch"))).toEqual([]);
  });

  it("is empty when the error carries no field errors", () => {
    const err = parseApiError(
      { error: { code: "FORBIDDEN", message: "Not allowed.", requestId: "r" } },
      403
    );

    expect(validationIssues(err)).toEqual([]);
  });

  // The wire is untrusted, so a field the server sent as the wrong type has to
  // arrive as absent rather than be passed along under a string type.
  it("drops a field that did not arrive as a string", () => {
    const err = parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "r",
          data: { errors: [{ path: 42, code: null, message: "Bad." }] },
        },
      },
      400
    );

    expect(validationIssues(err)).toEqual([
      { path: undefined, code: undefined, message: "Bad." },
    ]);
  });

  it("survives errors being something other than an array", () => {
    const err = parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "r",
          data: { errors: "nope" },
        },
      },
      400
    );

    expect(validationIssues(err)).toEqual([]);
  });
});

describe("apiErrorMessage", () => {
  it("says why, not that", () => {
    const err = parseApiError(
      validationBody([
        {
          path: "permissionIds",
          code: "REQUIRED",
          message: "At least one permission is required to create a role.",
        },
      ]),
      400
    );

    expect(apiErrorMessage(err)).toBe(
      "At least one permission is required to create a role."
    );
    expect(apiErrorMessage(err)).not.toBe("Validation failed.");
  });

  it("gives every reason when a form fails more than one", () => {
    const err = parseApiError(
      validationBody([
        { path: "name", code: "REQUIRED", message: "A role needs a name." },
        { path: "slug", code: "REQUIRED", message: "A role needs a slug." },
      ]),
      400
    );

    expect(apiErrorMessage(err)).toBe(
      "A role needs a name. A role needs a slug."
    );
  });

  it("uses the top-level message when there are no field errors", () => {
    const err = parseApiError(
      { error: { code: "FORBIDDEN", message: "Not allowed.", requestId: "r" } },
      403
    );

    expect(apiErrorMessage(err)).toBe("Not allowed.");
  });

  // A malformed payload should not produce "undefined" on screen.
  it("ignores field errors that carry no message", () => {
    const err = parseApiError(validationBody([{ path: "name" }]), 400);

    expect(apiErrorMessage(err)).toBe("Validation failed.");
  });

  it("ignores a field error whose message is blank", () => {
    // Same case as the one above by the time it reaches here, and it has to be:
    // a message with nothing in it explains nothing, so falling back to the
    // top-level sentence is what leaves a reader with something to read.
    const err = parseApiError(
      validationBody([{ path: "name", code: "REQUIRED", message: "   " }]),
      400
    );

    expect(apiErrorMessage(err)).toBe("Validation failed.");
  });

  it("survives being handed something that is not an error", () => {
    expect(apiErrorMessage("boom")).toBe("An error occurred");
    expect(apiErrorMessage(undefined)).toBe("An error occurred");
  });

  // The fallback exists so a screen can keep its own wording for the case the
  // server said nothing at all, instead of restating the generic default.
  describe("the caller-supplied fallback", () => {
    it("stands in when the error carries no message", () => {
      expect(apiErrorMessage(new Error(""), "Try that again.")).toBe(
        "Try that again."
      );
    });

    it("stands in when the value is not an error at all", () => {
      expect(apiErrorMessage(undefined, "Try that again.")).toBe(
        "Try that again."
      );
    });

    // It is a LAST resort, not an override: a server that explained itself
    // must still be the thing a person reads.
    it("never displaces a reason the server gave", () => {
      const err = parseApiError(
        validationBody([
          { path: "name", code: "REQUIRED", message: "A role needs a name." },
        ]),
        400
      );

      expect(apiErrorMessage(err, "Try that again.")).toBe(
        "A role needs a name."
      );
    });
  });
});
