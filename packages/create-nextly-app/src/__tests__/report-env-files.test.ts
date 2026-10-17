/**
 * What the run prints about the env files: what was written, what was added,
 * what was left for the person to change, and what still needs them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({ log }));

import { reportEnvFiles } from "../generators/report-env-files";

const printed = () =>
  [...log.info.mock.calls, ...log.warn.mock.calls, ...log.message.mock.calls]
    .map(([line]: [string]) => line)
    .join("\n");

describe("reportEnvFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says what was written and added, and passes the warnings on", () => {
    reportEnvFiles({
      files: {
        written: [".env.example"],
        changed: [{ path: ".env", added: ["NEXTLY_SECRET"] }],
        skipped: [],
      },
      warnings: ["NEXTLY_SECRET in .env is shorter than 32 characters."],
    });

    expect(printed()).toContain("Wrote .env.example");
    expect(printed()).toContain("Added NEXTLY_SECRET to .env");
    expect(log.warn).toHaveBeenCalledWith(
      "NEXTLY_SECRET in .env is shorter than 32 characters."
    );
  });

  // A file left alone still needs a line the person has to add: without it
  // here, .env stays stageable and the run says nothing.
  it("names a file it left alone, why, and the line to add", () => {
    reportEnvFiles({
      files: {
        written: [],
        changed: [],
        skipped: [
          {
            path: ".gitignore",
            why: "it is a link to a file shared outside this project",
            toAdd: ".env",
          },
        ],
      },
      warnings: [],
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/\.gitignore.*a link to a file shared/)
    );
    expect(log.message).toHaveBeenCalledWith(".env");
  });
});
