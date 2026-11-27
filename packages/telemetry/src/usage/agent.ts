import { existsSync } from "fs";

import { AGENT_NAMES, type AgentName } from "./catalog.js";
import { isMarkerSet, type Env } from "./env-flags.js";

// Who ran the installer or the CLI: a person, or a coding agent and which.
//
// `AI_AGENT` comes first: it is the variable agents set to name themselves,
// so when it names an agent that name wins over any other marker. Then each
// known agent's own variables, in the order `@vercel/detect-agent` 1.2.7
// checks them (read 2026-11-27), so Nextly reports the same agent that
// library would. A name not on the catalog's fixed list is sent as `other`:
// `AI_AGENT` is free text, and free text never leaves the machine.

export interface RunBy {
  run_by: "person" | "agent";
  /** Present only when `run_by` is `agent`. */
  agent?: AgentName;
}

interface AgentMarker {
  agent: AgentName;
  /** True when the agent's variables are set in `env`. */
  matches(env: Env): boolean;
}

const anyOf =
  (...names: string[]) =>
  (env: Env): boolean =>
    names.some(name => isMarkerSet(env[name]));

/** Each known agent's own markers, checked in this order after `AI_AGENT`. */
const AGENT_MARKERS: readonly AgentMarker[] = [
  { agent: "cursor", matches: anyOf("CURSOR_TRACE_ID") },
  {
    agent: "cursor-cli",
    matches: env =>
      isMarkerSet(env.CURSOR_AGENT) ||
      env.CURSOR_EXTENSION_HOST_ROLE === "agent-exec",
  },
  { agent: "gemini", matches: anyOf("GEMINI_CLI") },
  {
    agent: "codex",
    matches: anyOf("CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID"),
  },
  { agent: "antigravity", matches: anyOf("ANTIGRAVITY_AGENT") },
  { agent: "augment-cli", matches: anyOf("AUGMENT_AGENT") },
  { agent: "opencode", matches: anyOf("OPENCODE", "OPENCODE_CLIENT") },
  {
    agent: "cowork",
    matches: env =>
      anyOf("CLAUDECODE", "CLAUDE_CODE")(env) &&
      isMarkerSet(env.CLAUDE_CODE_IS_COWORK),
  },
  { agent: "claude", matches: anyOf("CLAUDECODE", "CLAUDE_CODE") },
  { agent: "replit", matches: anyOf("REPL_ID") },
  {
    agent: "github-copilot",
    // Presence only: the token's value is never read past this check.
    matches: anyOf(
      "COPILOT_MODEL",
      "COPILOT_ALLOW_ALL",
      "COPILOT_GITHUB_TOKEN"
    ),
  },
];

/** Devin marks its machines with this file rather than a variable. */
const DEVIN_MARKER_FILE = "/opt/.devin";

/** `AI_AGENT`'s spellings that mean an agent on the list under another name. */
const AI_AGENT_ALIASES: Readonly<Record<string, AgentName>> = {
  "github-copilot-cli": "github-copilot",
};

function knownAgent(name: string): AgentName {
  const normalised = name.trim().toLowerCase();
  const alias = AI_AGENT_ALIASES[normalised];
  if (alias) return alias;
  const found = AGENT_NAMES.find(known => known === normalised);
  return found ?? "other";
}

export interface DetectAgentOptions {
  /** For tests: whether a file exists. Defaults to the real file system. */
  fileExists?: (path: string) => boolean;
}

/** Decides `run_by` and the agent's name for this run from its environment. */
export function detectAgent(env: Env, opts: DetectAgentOptions = {}): RunBy {
  // Read like any marker: `0`, `false` or nothing means no agent.
  const named = env.AI_AGENT;
  if (named !== undefined && isMarkerSet(named)) {
    return { run_by: "agent", agent: knownAgent(named) };
  }

  for (const marker of AGENT_MARKERS) {
    if (marker.matches(env)) return { run_by: "agent", agent: marker.agent };
  }

  const fileExists = opts.fileExists ?? existsSync;
  try {
    if (fileExists(DEVIN_MARKER_FILE))
      return { run_by: "agent", agent: "devin" };
  } catch {
    // An unreadable file system means no marker, not a failed run.
  }
  return { run_by: "person" };
}
