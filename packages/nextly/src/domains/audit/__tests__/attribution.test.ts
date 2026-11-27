/**
 * How a caller's attribution becomes the columns an activity or audit row
 * stores: an agent and the person it acted for, the door, the credential by
 * id, an approval, a grant, an undo, or a deployment.
 */
import { describe, expect, it } from "vitest";

import {
  attributionColumns,
  EMPTY_ATTRIBUTION_COLUMNS,
  type ActorAttribution,
} from "../attribution";

const PASS_ID = "5f0c2a8e-3d41-4b7a-9c55-1e2f3a4b5c6d";

describe("attribution columns", () => {
  it("stores nothing for a caller with no attribution", () => {
    expect(attributionColumns(undefined)).toEqual({
      columns: EMPTY_ATTRIBUTION_COLUMNS,
      refused: [],
    });
    expect(attributionColumns({})).toEqual({
      columns: EMPTY_ATTRIBUTION_COLUMNS,
      refused: [],
    });
  });

  it.each([
    { door: "local", credential: "pass" },
    { door: "command", credential: "pass" },
    { door: "chat-app", credential: "connection" },
    { door: "rest-key", credential: "key" },
  ] as const)(
    "stores an agent acting through the $door door with its $credential by id",
    ({ door }) => {
      const { columns, refused } = attributionColumns({
        door,
        agent: { name: "Claude Code", sessionId: "sess-1" },
        credentialId: PASS_ID,
      });
      expect(refused).toEqual([]);
      expect(columns).toEqual({
        ...EMPTY_ATTRIBUTION_COLUMNS,
        agentName: "Claude Code",
        agentSessionId: "sess-1",
        door,
        credentialId: PASS_ID,
      });
    }
  );

  it("stores the approval, the grant and the undo on the same row", () => {
    const { columns } = attributionColumns({
      door: "command",
      agent: { name: "Claude Code", sessionId: "sess-1" },
      credentialId: PASS_ID,
      approval: { requestId: "req-1", approvedBy: "user-1", via: "phone" },
      grantId: "grant-1",
      undoesSessionId: "sess-0",
    });
    expect(columns).toMatchObject({
      approvalRequestId: "req-1",
      approvedByUserId: "user-1",
      approvedVia: "phone",
      grantId: "grant-1",
      undoesSessionId: "sess-0",
    });
  });

  it("stores a pipeline deployment by host and commit, through the deploy door", () => {
    expect(
      attributionColumns({
        deployment: { pipeline: "Vercel build", commit: "3f2a1c9" },
      }).columns
    ).toEqual({
      ...EMPTY_ATTRIBUTION_COLUMNS,
      door: "deploy",
      deploymentHost: "Vercel build",
      deploymentCommit: "3f2a1c9",
    });
    // A pipeline whose host gives no commit is still recorded, as one with
    // no commit, which the wording says is unknown.
    expect(
      attributionColumns({
        deployment: { pipeline: "GitHub Actions", commit: null },
      }).columns
    ).toMatchObject({
      door: "deploy",
      deploymentHost: "GitHub Actions",
      deploymentCommit: null,
    });
  });

  it("stores a deployment from a machine through the local door, by the machine's name", () => {
    expect(
      attributionColumns({ deployment: { machine: "studio-mac" } }).columns
    ).toEqual({
      ...EMPTY_ATTRIBUTION_COLUMNS,
      door: "local",
      deploymentHost: "studio-mac",
    });
  });

  it("refuses a deployment on a person's row, so no machine name outlives their erasure", () => {
    // A deployment is the Deployment actor's own: a row whose actor is a
    // person is erased with them, and a machine's name ("Sara's MacBook Pro")
    // may name them, so such a row never stores one.
    const { columns, refused } = attributionColumns(
      { deployment: { machine: "Sara-Maliks-MacBook-Pro" } },
      { actorIsPerson: true }
    );
    expect(refused).toEqual(["deployment"]);
    expect(columns.deploymentHost).toBeNull();
    expect(columns.door).toBeNull();
    // The rest of a person's row still lands.
    expect(
      attributionColumns(
        { door: "local", agent: { name: "Claude Code" } },
        { actorIsPerson: true }
      )
    ).toEqual({
      columns: {
        ...EMPTY_ATTRIBUTION_COLUMNS,
        door: "local",
        agentName: "Claude Code",
      },
      refused: [],
    });
  });

  it("refuses a door that contradicts the deployment's own", () => {
    const { columns, refused } = attributionColumns({
      door: "command",
      deployment: { pipeline: "Vercel build", commit: "3f2a1c9" },
    });
    expect(refused).toEqual(["door"]);
    expect(columns.door).toBe("deploy");
  });

  describe("never stores a token", () => {
    // 🔴 Each is a secret a caller might pass where an id belongs: a whole
    // API key, a signed token, an authorization header's value. A plain
    // length or "non-empty" check accepts every one of them.
    const SECRETS = [
      "nx_live_0123456789abcdef01234567_Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "Bearer 5f0c2a8e-3d41-4b7a-9c55-1e2f3a4b5c6d",
      // A reset, invite or CSRF token: 32 random bytes as hex, 64 characters
      // of exactly the alphabet an id uses.
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      // A key's secret part, 32 random bytes as base64url, here without an
      // underscore, as about half of them are.
      "q3Rk9Xv0bLmN2pQe7sTuVw1yZaB4cD6fG8hJ0kLm2nP",
      // A short credential that fits an id's length and alphabet: only its
      // known shape tells it apart.
      "glpat-AbCdEfGhIjKlMnOpQrSt",
    ];

    it.each(SECRETS)(
      "refuses %s as any id, keeping the rest of the row",
      secret => {
        const attribution: ActorAttribution = {
          door: "command",
          agent: { name: "Claude Code", sessionId: secret },
          credentialId: secret,
          approval: { requestId: secret, approvedBy: secret, via: "phone" },
          grantId: secret,
          undoesSessionId: secret,
        };
        const { columns, refused } = attributionColumns(attribution);
        expect(refused.sort()).toEqual(
          [
            "agent.sessionId",
            "approval.approvedBy",
            "approval.requestId",
            "credentialId",
            "grantId",
            "undoesSessionId",
          ].sort()
        );
        expect(Object.values(columns)).not.toContain(secret);
        // The facts that are not ids still land.
        expect(columns).toMatchObject({
          agentName: "Claude Code",
          door: "command",
          approvedVia: "phone",
        });
      }
    );

    it("accepts a key's own id, a uuid and a short readable id", () => {
      const { refused } = attributionColumns({
        door: "rest-key",
        credentialId: "0123456789abcdef01234567",
        agent: { name: "Cursor", sessionId: PASS_ID },
        grantId: "grant-7",
      });
      expect(refused).toEqual([]);
    });
  });

  it("refuses a credential passed where a name belongs", () => {
    // A name has no shape of its own to check, so the repository's catalogue
    // of credential shapes is what keeps a token out of it.
    for (const secret of [
      // Known to the catalogue of credential shapes.
      "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      // Not in the catalogue: a whole Nextly key, a hex reset token. Each is
      // one long run with no space, which no name is.
      "nx_live_0123456789abcdef01234567_Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA",
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      // A known short credential inside an otherwise ordinary label.
      "runner glpat-AbCdEfGhIjKlMnOpQrSt",
      // A whole Nextly key inside a label.
      "ci nx_live_0123456789abcdef01234567_x",
    ]) {
      const { columns, refused } = attributionColumns({
        agent: { name: secret },
        deployment: { pipeline: secret, commit: null },
      });
      expect(refused.sort()).toEqual(["agent.name", "deployment.host"]);
      expect(Object.values(columns)).not.toContain(secret);
    }
    // Ordinary names still land, a long machine name among them.
    expect(
      attributionColumns({
        agent: { name: "Claude Code" },
        deployment: { machine: "Sara-Maliks-MacBook-Pro.local" },
      }).refused
    ).toEqual([]);
    // A long host name with no space is a host, not a token.
    const host = attributionColumns({
      deployment: {
        pipeline: "long-production-project-preview.vercel.app",
        commit: null,
      },
    });
    expect(host.refused).toEqual([]);
    expect(host.columns.deploymentHost).toBe(
      "long-production-project-preview.vercel.app"
    );
  });

  it("refuses a name holding a NUL or another control character", () => {
    // PostgreSQL cannot store a NUL: the write being recorded would fail.
    expect(
      attributionColumns({ agent: { name: "Claude\u0000Code" } }).refused
    ).toEqual(["agent.name"]);
    expect(
      attributionColumns({ deployment: { machine: "studio\nmac" } }).refused
    ).toEqual(["deployment.host"]);
  });

  it("stores ids in lower case, so every database matches them alike", () => {
    // MySQL compares these columns without regard to case; PostgreSQL and
    // SQLite do not. One spelling makes a filter answer the same everywhere.
    expect(
      attributionColumns({
        agent: { name: "Claude Code", sessionId: "Run-A" },
        credentialId: "5F0C2A8E-3D41-4B7A-9C55-1E2F3A4B5C6D",
      }).columns
    ).toMatchObject({
      agentSessionId: "run-a",
      credentialId: "5f0c2a8e-3d41-4b7a-9c55-1e2f3a4b5c6d",
      // A name is shown as written.
      agentName: "Claude Code",
    });
  });

  it("refuses an empty or overlong agent name, and a malformed commit", () => {
    expect(attributionColumns({ agent: { name: "   " } }).refused).toEqual([
      "agent.name",
    ]);
    expect(
      attributionColumns({ agent: { name: "x".repeat(192) } }).refused
    ).toEqual(["agent.name"]);
    const commit = attributionColumns({
      deployment: { pipeline: "Vercel build", commit: "not a sha" },
    });
    expect(commit.refused).toEqual(["deployment.commit"]);
    expect(commit.columns.deploymentCommit).toBeNull();
  });

  it("refuses a door or an approval place it does not know", () => {
    const { columns, refused } = attributionColumns({
      door: "fax" as never,
      approval: {
        requestId: "req-1",
        approvedBy: "user-1",
        via: "pager" as never,
      },
    });
    expect(refused.sort()).toEqual(["approval.via", "door"]);
    expect(columns.door).toBeNull();
    expect(columns.approvedVia).toBeNull();
    expect(columns.approvalRequestId).toBe("req-1");
  });
});
