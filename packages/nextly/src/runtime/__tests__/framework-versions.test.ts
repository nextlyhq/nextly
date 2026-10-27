/**
 * nextly refuses to start outside the Next.js, React and React DOM ranges it
 * supports, judging each package on its own, and names what it found.
 *
 * The installed versions are handed in, so each case is the version under
 * test and nothing about this machine's own install.
 */
import { describe, expect, it } from "vitest";

import {
  assertSupportedFrameworkVersions,
  type FrameworkPackage,
  frameworkVersionProblems,
  SUPPORTED_FRAMEWORK_RANGES,
} from "../framework-versions";

const IN_RANGE: Record<FrameworkPackage, string> = {
  next: "16.4.2",
  react: "19.3.1",
  "react-dom": "19.3.1",
};

/** An install with `overrides` in place of the in-range versions. */
function installed(
  overrides: Partial<Record<FrameworkPackage, string | null>>
): (appRoot: string, name: FrameworkPackage) => string | null {
  return (_appRoot, name) =>
    name in overrides ? (overrides[name] ?? null) : IN_RANGE[name];
}

function refusal(
  overrides: Partial<Record<FrameworkPackage, string | null>>
): unknown {
  try {
    assertSupportedFrameworkVersions("/app", installed(overrides));
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the start-time version check", () => {
  it("starts with every package in range", () => {
    expect(refusal({})).toBeUndefined();
  });

  const cases: Array<[FrameworkPackage, string, string]> = [
    ["next", "16.3.0", "too old"],
    ["next", "17.0.0", "too new"],
    ["react", "19.2.0", "too old"],
    ["react", "20.0.0", "too new"],
    ["react-dom", "18.3.1", "too old"],
    ["react-dom", "20.0.0", "too new"],
  ];
  for (const [name, version, which] of cases) {
    it(`refuses ${name} ${which} (${version}), naming it and its range`, () => {
      const error = refusal({ [name]: version });
      expect(error).toMatchObject({
        code: "CONFIGURATION_ERROR",
        logContext: {
          problems: [
            {
              name,
              installed: version,
              supported: SUPPORTED_FRAMEWORK_RANGES[name],
            },
          ],
        },
      });
      expect((error as { logMessage?: string }).logMessage).toContain(
        `${name}@${version} (supported: ${SUPPORTED_FRAMEWORK_RANGES[name]})`
      );
    });
  }

  it("judges React DOM on its own, refusing it below its range with React in range", () => {
    expect(
      frameworkVersionProblems("/app", installed({ "react-dom": "19.2.4" }))
    ).toEqual([
      {
        name: "react-dom",
        installed: "19.2.4",
        supported: SUPPORTED_FRAMEWORK_RANGES["react-dom"],
      },
    ]);
  });

  it("names every package outside its range, not only the first", () => {
    expect(
      frameworkVersionProblems(
        "/app",
        installed({ next: "15.5.0", react: "18.3.1" })
      ).map(p => p.name)
    ).toEqual(["next", "react"]);
  });

  it("does not judge a package the app does not have", () => {
    expect(
      frameworkVersionProblems(
        "/app",
        installed({ next: null, react: null, "react-dom": null })
      )
    ).toEqual([]);
  });

  it("counts a prerelease of a supported release as in range", () => {
    expect(
      frameworkVersionProblems("/app", installed({ next: "16.5.0-canary.3" }))
    ).toEqual([]);
  });
});
