/**
 * Turning a server's field errors into something a form can point at.
 *
 * The subject here is the NARROWING, not the reading. `parseServerErrors` wants
 * a path, a code and a message on every issue, because it names a form control
 * with them and an issue missing any of the three cannot address one. That is a
 * stricter requirement than a consumer showing a sentence has — and the two
 * used to be expressed as two separate traversals of `data.errors`, which is
 * how they came to disagree.
 *
 * So what this file asserts is that the strict view is DERIVED from the shared
 * one: same reading, different requirement.
 *
 * @module lib/errors/error-mapping.test
 */
import { describe, expect, it } from "vitest";

import { validationIssues, parseApiError } from "../api/parseApiError";
import {
  applyServerFieldErrors,
  parseServerErrors,
  pathOnForm,
  placeServerRefusal,
} from "./error-mapping";

/** A canonical validation body, as the wire carries it. */
const body = (errors: unknown[]) => ({
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed.",
    requestId: "req_x",
    data: { errors },
  },
});

const COMPLETE = {
  path: "email",
  code: "INVALID_FORMAT",
  message: "Must be a valid email address.",
};

describe("parseServerErrors", () => {
  it("keeps an issue that can name a field", () => {
    expect(parseServerErrors(body([COMPLETE]))).toEqual([COMPLETE]);
  });

  it("returns null for anything that is not a canonical error body", () => {
    expect(parseServerErrors({ oops: true })).toBeNull();
    expect(parseServerErrors(null)).toBeNull();
    expect(parseServerErrors("nope")).toBeNull();
  });

  it("unwraps a fetch/axios-style response before reading it", () => {
    // The wrapper case the function has always accepted, asserted because the
    // derivation below must not quietly drop it.
    expect(parseServerErrors({ response: { data: body([COMPLETE]) } })).toEqual(
      [COMPLETE]
    );
  });

  describe("the requirement it adds on top of the shared reading", () => {
    it.each([
      ["no path", { code: "REQUIRED", message: "Need it." }],
      ["no code", { path: "email", message: "Need it." }],
      ["no message", { path: "email", code: "REQUIRED" }],
      ["a blank message", { path: "email", code: "REQUIRED", message: "  " }],
    ])("drops an issue with %s", (_name, issue) => {
      expect(parseServerErrors(body([issue]))).toEqual([]);
    });

    it("drops only the unusable one, keeping the rest", () => {
      expect(parseServerErrors(body([COMPLETE, { path: "name" }]))).toEqual([
        COMPLETE,
      ]);
    });
  });

  // The property the derivation exists for. Two independent traversals of
  // `data.errors` agreed on the day they were written and disagreed on partial
  // issues; anything this file can assert about one reading has to hold for the
  // other, on the same input.
  describe("agrees with the shared reading", () => {
    it("is exactly the subset of validationIssues that names all three", () => {
      const errors = [
        COMPLETE,
        { path: "name" },
        { path: "slug", code: "REQUIRED", message: "" },
        { code: "REQUIRED", message: "Orphaned." },
        "not an object",
      ];

      const shared = validationIssues(parseApiError(body(errors), 400));
      const strict = parseServerErrors(body(errors));

      expect(strict).toEqual(
        shared.filter(
          i =>
            i.path !== undefined &&
            i.code !== undefined &&
            i.message !== undefined
        )
      );
      // And the shared reading really did see more than the strict one, or the
      // assertion above is satisfied by both being empty.
      expect(shared.length).toBeGreaterThan((strict ?? []).length);
    });
  });
});

// The rejection the entry form actually meets. `fetcher` throws the error
// `parseApiError` builds, which carries the body's `data` on the error itself:
// there is no `error` key and no `response` wrapper to read, so a reader of
// only those two shapes finds nothing and the field's reason never reaches it.
describe("a thrown ApiError", () => {
  it("is read for its field errors", () => {
    const thrown = parseApiError(body([COMPLETE]), 400);
    expect(parseServerErrors(thrown)).toEqual([COMPLETE]);
  });

  it("drops an issue that cannot name a field, as a body does", () => {
    const thrown = parseApiError(
      body([COMPLETE, { code: "REFUSED", message: "No field." }]),
      400
    );
    expect(parseServerErrors(thrown)).toEqual([COMPLETE]);
  });

  it("is not mistaken for a body when it carries no field errors", () => {
    const thrown = parseApiError(
      { error: { code: "FORBIDDEN", message: "No." } },
      403
    );
    expect(parseServerErrors(thrown)).toBeNull();
  });
});

describe("applyServerFieldErrors", () => {
  // The form draws `email` and `title`; a path is on it by its first step.
  const onForm = pathOnForm(new Set(["email", "title"]));

  it("reads a path as on the form by the field it starts at", () => {
    expect(onForm("title.en")).toBe(true);
    expect(onForm("email[0]")).toBe(true);
    expect(onForm("titles")).toBe(false);
    expect(onForm("status")).toBe(false);
  });

  it("puts each reason on its field and leaves nothing to say elsewhere", () => {
    const set: [string, { type: string; message: string }][] = [];
    const result = applyServerFieldErrors(
      parseApiError(body([COMPLETE]), 400),
      (path, error) => {
        set.push([path, error as { type: string; message: string }]);
      },
      { isFormField: onForm, scrollToError: false, focusFirst: false }
    );
    expect(set).toEqual([
      ["email", { type: "server", message: COMPLETE.message }],
    ]);
    expect(result).toEqual({ mapped: 1, unplaced: [] });
  });

  it("hands back the reasons no field on the form can show", () => {
    const set: string[] = [];
    const result = applyServerFieldErrors(
      parseApiError(
        body([
          COMPLETE,
          // A path the form does not draw: its reason would vanish if set.
          { path: "status", code: "REFUSED", message: "Still in use." },
          // No path at all.
          { code: "REFUSED", message: "Not now." },
        ]),
        400
      ),
      path => {
        set.push(path);
      },
      { isFormField: onForm, scrollToError: false, focusFirst: false }
    );
    expect(set).toEqual(["email"]);
    expect(result).toEqual({
      mapped: 1,
      unplaced: ["Still in use.", "Not now."],
    });
  });

  it("maps a nested path by the field it starts at", () => {
    const set: string[] = [];
    applyServerFieldErrors(
      parseApiError(
        body([{ path: "title.en", code: "TOO_LONG", message: "Too long." }]),
        400
      ),
      path => {
        set.push(path);
      },
      { isFormField: onForm, scrollToError: false, focusFirst: false }
    );
    expect(set).toEqual(["title.en"]);
  });

  it("maps nothing for an error that carries no field errors", () => {
    expect(
      applyServerFieldErrors(
        new Error("offline"),
        () => {
          throw new Error("must not be called");
        },
        { isFormField: onForm }
      )
    ).toEqual({ mapped: 0, unplaced: [] });
  });
});

describe("placeServerRefusal", () => {
  const quiet = {
    isFormField: pathOnForm(new Set(["email"])),
    scrollToError: false,
    focusFirst: false,
  };

  it("leaves nothing for a toast when every reason is on a field", () => {
    expect(
      placeServerRefusal(parseApiError(body([COMPLETE]), 400), () => {}, quiet)
    ).toEqual({ handled: true, toastMessage: undefined });
  });

  it("gives the toast the reasons with no field, not the bare envelope", () => {
    expect(
      placeServerRefusal(
        parseApiError(
          body([
            COMPLETE,
            { path: "status", code: "REFUSED", message: "Still in use." },
          ]),
          400
        ),
        () => {},
        quiet
      )
    ).toEqual({ handled: false, toastMessage: "Still in use." });
  });

  it("leaves the caller's message for a refusal with no reasons", () => {
    expect(placeServerRefusal(new Error("offline"), () => {}, quiet)).toEqual({
      handled: false,
      toastMessage: undefined,
    });
  });
});
