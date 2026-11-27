/**
 * Who acted, in words, with who stood behind them: the one wording the
 * Team activity card and the entry history both say.
 */
import { describe, expect, it } from "vitest";

import {
  asSentenceSubject,
  attributedActorName,
} from "../history-story-attribution";

describe("who acted, with who stood behind them", () => {
  it("names the person alone when nothing stood behind them", () => {
    expect(attributedActorName("Sara Malik", {})).toBe("Sara Malik");
    expect(
      attributedActorName("Sara Malik", {
        agentName: null,
        door: null,
        approvedVia: null,
      })
    ).toBe("Sara Malik");
  });

  it("names the agent, for the person it acted for", () => {
    expect(
      attributedActorName("Sara Malik", {
        agentName: "Claude Code",
        door: "command",
      })
    ).toBe("Claude Code, for Sara Malik");
  });

  it("says where an approval was given, beside who acted", () => {
    expect(
      attributedActorName("Sara Malik", {
        agentName: "Claude Code",
        door: "command",
        approvedVia: "phone",
      })
    ).toBe("Claude Code, for Sara Malik, approved on phone");
    expect(
      attributedActorName("Sara Malik", {
        agentName: "Claude Code",
        approvedVia: "browser",
      })
    ).toBe("Claude Code, for Sara Malik, approved in the browser");
    expect(attributedActorName("Sara Malik", { approvedVia: "admin" })).toBe(
      "Sara Malik, approved in the admin"
    );
  });

  it("says the person worked from the command line, with any agent named", () => {
    expect(attributedActorName("Sara Malik", { door: "local" })).toBe(
      "Sara Malik, from the command line"
    );
    expect(
      attributedActorName("Sara Malik", {
        agentName: "Claude Code",
        door: "local",
      })
    ).toBe("Claude Code, for Sara Malik, from the command line");
  });

  it("names a deployment by its host and short commit, in place of the actor", () => {
    expect(
      attributedActorName("System", {
        door: "deploy",
        deploymentHost: "Vercel build",
        deploymentCommit: "3f2a1c9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
      })
    ).toBe("Deployment (Vercel build, commit 3f2a1c9)");
    expect(
      attributedActorName("System", {
        door: "deploy",
        deploymentHost: "GitHub Actions",
        deploymentCommit: null,
      })
    ).toBe("Deployment (GitHub Actions, commit unknown)");
  });

  it("names a deployment from a person's machine by the machine", () => {
    expect(
      attributedActorName("System", {
        door: "local",
        deploymentHost: "studio-mac",
      })
    ).toBe("Deployment (this machine, studio-mac)");
  });

  it("ignores a door or a place it has no words for, rather than printing it", () => {
    expect(
      attributedActorName("Sara Malik", {
        agentName: "Claude Code",
        door: "fax",
        approvedVia: "pager",
      })
    ).toBe("Claude Code, for Sara Malik");
  });
});

describe("an actor's name as a sentence's subject", () => {
  it("closes the name's own clauses with a comma, before the verb", () => {
    expect(asSentenceSubject("Claude Code, for Ana, approved on phone")).toBe(
      "Claude Code, for Ana, approved on phone,"
    );
    expect(asSentenceSubject("Ana, from the command line")).toBe(
      "Ana, from the command line,"
    );
  });

  it("leaves a name without clauses, and a deployment's own commas, as they are", () => {
    expect(asSentenceSubject("Ana")).toBe("Ana");
    expect(asSentenceSubject("[deleted user · u1]")).toBe(
      "[deleted user · u1]"
    );
    expect(asSentenceSubject("Deployment (Vercel build, commit 3f2a1c9)")).toBe(
      "Deployment (Vercel build, commit 3f2a1c9)"
    );
  });
});
