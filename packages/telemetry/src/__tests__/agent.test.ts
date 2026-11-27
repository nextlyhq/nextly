import { describe, expect, it } from "vitest";

import { AGENT_NAMES, detectAgent } from "../index.js";

// Who ran it: `AI_AGENT` first, then each known agent's own markers, with
// anything not on the fixed list sent as `other`. The file check is stubbed
// so a test machine's own files cannot decide the answer.
const noFiles = { fileExists: () => false };

describe("agent detection", () => {
  it("is a person with no marker set", () => {
    expect(detectAgent({}, noFiles)).toEqual({ run_by: "person" });
  });

  it("takes the agent's name from AI_AGENT", () => {
    expect(detectAgent({ AI_AGENT: "claude" }, noFiles)).toEqual({
      run_by: "agent",
      agent: "claude",
    });
  });

  it("reads AI_AGENT whatever its case and spacing", () => {
    expect(detectAgent({ AI_AGENT: "  Codex " }, noFiles)).toEqual({
      run_by: "agent",
      agent: "codex",
    });
  });

  it("sends an AI_AGENT name not on the list as other", () => {
    expect(detectAgent({ AI_AGENT: "acme-internal-bot" }, noFiles)).toEqual({
      run_by: "agent",
      agent: "other",
    });
  });

  it("maps github-copilot-cli to github-copilot", () => {
    expect(detectAgent({ AI_AGENT: "github-copilot-cli" }, noFiles)).toEqual({
      run_by: "agent",
      agent: "github-copilot",
    });
  });

  it.each([
    [{ CLAUDECODE: "1" }, "claude"],
    [{ CURSOR_TRACE_ID: "3f0c" }, "cursor"],
    [{ CODEX_SANDBOX: "seatbelt" }, "codex"],
    [{ GEMINI_CLI: "1" }, "gemini"],
    [{ OPENCODE_CLIENT: "cli" }, "opencode"],
    [{ CLAUDECODE: "1", CLAUDE_CODE_IS_COWORK: "1" }, "cowork"],
    [{ CURSOR_EXTENSION_HOST_ROLE: "agent-exec" }, "cursor-cli"],
    [{ COPILOT_MODEL: "x" }, "github-copilot"],
  ])("recognises %j as %s", (env, agent) => {
    expect(detectAgent(env, noFiles)).toEqual({ run_by: "agent", agent });
  });

  it("recognises Devin by its marker file", () => {
    const seen: string[] = [];
    const result = detectAgent(
      {},
      {
        fileExists: path => {
          seen.push(path);
          return path === "/opt/.devin";
        },
      }
    );
    expect(result).toEqual({ run_by: "agent", agent: "devin" });
    expect(seen).toEqual(["/opt/.devin"]);
  });

  it("uses AI_AGENT's name before another agent's marker", () => {
    expect(
      detectAgent({ AI_AGENT: "codex", CLAUDECODE: "1" }, noFiles)
    ).toEqual({ run_by: "agent", agent: "codex" });
  });

  it("falls back to the markers when AI_AGENT is blank", () => {
    expect(detectAgent({ AI_AGENT: "  ", CLAUDECODE: "1" }, noFiles)).toEqual({
      run_by: "agent",
      agent: "claude",
    });
  });

  it("does not count a marker set to 0 or false", () => {
    expect(
      detectAgent({ CLAUDECODE: "0", GEMINI_CLI: "false" }, noFiles)
    ).toEqual({ run_by: "person" });
  });

  it("only ever answers a name on the catalog's list", () => {
    const answers = [
      detectAgent({ AI_AGENT: "anything" }, noFiles),
      detectAgent({ AI_AGENT: "claude" }, noFiles),
      detectAgent({ REPL_ID: "x" }, noFiles),
    ];
    for (const answer of answers) {
      expect(AGENT_NAMES).toContain(answer.agent);
    }
  });
});
