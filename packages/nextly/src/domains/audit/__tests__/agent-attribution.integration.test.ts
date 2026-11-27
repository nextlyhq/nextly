/**
 * Who stands behind a caller, as the activity log, the audit log and the
 * record of content events keep it, on every configured dialect.
 *
 * A write carries its attribution on the request actor; the person stays the
 * actor, so each row names them as it always has, and beside them the agent
 * that acted for them, the door the call came through, the pass, connection
 * or key by id, and, when they were involved, the approval, the standing grant
 * or the undo. A deployment and the local owner at the command line are
 * recorded the same way. No row ever holds a token.
 *
 * These rows are written through the writers each caller will use; the doors
 * themselves attach the attribution in their own changes.
 *
 * @module domains/audit/__tests__/agent-attribution.integration.test
 */
// Read by the content-event write for a plugin-defined person, through the
// env proxy: set before any of it is imported. A throwaway value.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { runAsPrincipal } from "../../../auth/principal-scope";
import type { RequestActor } from "../../../auth/request-actor";
import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ActivityLogService } from "../../../services/dashboard/activity-log-service";
import { allResources } from "../../../services/dashboard/readable-resources";
import { attachVersionAuthors } from "../../versions/author-hydration";
import type { ActorAttribution } from "../attribution";
import { buildAuditLogWriter } from "../audit-log-writer";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const PERSON = {
  id: "5a1c7e0e-0b7a-4c55-9d3e-6f1e2a3b4c5d",
  name: "Sara Malik",
  email: "sara@example.test",
};
const APPROVER = "8b2d4f6a-1c3e-4a5b-8c7d-9e0f1a2b3c4d";
const PASS_ID = "2f4e6a8c-0b1d-4e3f-9a5b-7c9d1e3f5a7b";
const SESSION_ID = "c3d5e7f9-1a2b-4c4d-8e6f-0a1b2c3d4e5f";

/** A whole API key: what must never reach a row, wherever an id belongs. */
const TOKEN =
  "nx_live_0123456789abcdef01234567_c2VjcmV0LXZhbHVlLXRoYXQtbXVzdC1uZXZlci1sYW5k";

/** The attribution columns of a row, as Drizzle reads them back. */
interface AttributedRow {
  id: string;
  agentName: string | null;
  agentSessionId: string | null;
  door: string | null;
  credentialId: string | null;
  approvalRequestId: string | null;
  approvedByUserId: string | null;
  approvedVia: string | null;
  grantId: string | null;
  undoesSessionId: string | null;
  deploymentHost: string | null;
  deploymentCommit: string | null;
}

interface ActivityRow extends AttributedRow {
  actorType: string | null;
  userId: string;
  userName: string | null;
  collection: string;
  action: string;
}

interface AuditRow extends AttributedRow {
  kind: string;
  actorKind: string | null;
  actorUserId: string | null;
}

interface EventRow {
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  actorAgentName: string | null;
}

/** A harness with one collection and the person's account. */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
      // Kept in versions, so its history lists each save as a version row.
      defineCollection({
        slug: "notes",
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  await current.adapter.insert("users", {
    id: PERSON.id,
    name: PERSON.name,
    email: PERSON.email,
    is_active: true,
  });
  return current;
}

/** Create an entry as the person, with what stands behind them. */
async function createAs(
  t: TestNextly,
  attribution: ActorAttribution | undefined,
  title = "hello",
  collectionName = "posts"
): Promise<string> {
  const actor: RequestActor = { type: "user", id: PERSON.id, attribution };
  const created = await t.getService("collectionsHandler").createEntry(
    {
      collectionName,
      overrideAccess: true,
      // The event takes the person's name from the signed-in user, as a
      // request's session carries it.
      user: { id: PERSON.id, email: PERSON.email, name: PERSON.name },
      actor,
    },
    { title }
  );
  return (created.data as { id: string }).id;
}

async function activityRows(t: TestNextly): Promise<ActivityRow[]> {
  return t.adapter.select<ActivityRow>("activity_log");
}

async function auditRows(t: TestNextly): Promise<AuditRow[]> {
  return t.adapter.select<AuditRow>("audit_log");
}

function auditWriter(t: TestNextly) {
  return buildAuditLogWriter(name =>
    t.getService(name as Parameters<TestNextly["getService"]>[0])
  );
}

/** Every value in every column of every row, as text. */
async function everyStoredValue(
  t: TestNextly,
  table: string
): Promise<string[]> {
  const all = await t.adapter.select<Record<string, unknown>>(table);
  return all.flatMap(row =>
    Object.values(row).map(value =>
      typeof value === "string" ? value : JSON.stringify(value ?? null)
    )
  );
}

const DOORS = [
  ["local", "the CLI on the person's machine"],
  ["command", "the site's command door"],
  ["chat-app", "the chat-app door"],
  ["rest-key", "REST with an agent-marked key"],
] as const;

describe.each(getConfiguredTestDialects())(
  "agent attribution on the activity and audit rows (%s)",
  dialect => {
    it.each(DOORS)(
      "records an agent acting for the person through %s (%s)",
      async door => {
        const t = await boot(dialect);
        const attribution: ActorAttribution = {
          door,
          agent: { name: "Claude Code", sessionId: SESSION_ID },
          credentialId: PASS_ID,
        };

        await createAs(t, attribution);
        await auditWriter(t).write({
          kind: "login-succeeded",
          actorUserId: PERSON.id,
          attribution,
        });

        const [activity] = await activityRows(t);
        // The person is still who acted: their id and name, as on any row.
        expect(activity).toMatchObject({
          actorType: "user",
          userId: PERSON.id,
          userName: PERSON.name,
          agentName: "Claude Code",
          agentSessionId: SESSION_ID,
          door,
          credentialId: PASS_ID,
          approvalRequestId: null,
          grantId: null,
        });
        const [audit] = await auditRows(t);
        expect(audit).toMatchObject({
          actorKind: "staff",
          actorUserId: PERSON.id,
          agentName: "Claude Code",
          agentSessionId: SESSION_ID,
          door,
          credentialId: PASS_ID,
        });
      }
    );

    it("records the agent's name beside the person on the entry's history", async () => {
      const t = await boot(dialect);
      await createAs(t, {
        door: "command",
        agent: { name: "Claude Code", sessionId: SESSION_ID },
        credentialId: PASS_ID,
      });
      await createAs(t, undefined, "by hand");

      const events = await t.adapter.select<EventRow>("nextly_content_events");
      const byAgent = events.filter(e => e.actorAgentName !== null);
      expect(byAgent).toHaveLength(1);
      expect(byAgent[0]).toMatchObject({
        actorKind: "person",
        actorId: PERSON.id,
        actorName: PERSON.name,
        actorAgentName: "Claude Code",
      });
      // The person's own edit names no agent.
      expect(events.some(e => e.actorAgentName === null)).toBe(true);
    });

    it("names the agent beside the person on the entry's version row", async () => {
      // A save's event is folded into its version row in the history, which
      // names the version's author: the agent must reach that author too.
      const t = await boot(dialect);
      const byAgent = await createAs(
        t,
        {
          door: "command",
          agent: { name: "Claude Code" },
          credentialId: PASS_ID,
        },
        "by an agent",
        "notes"
      );
      const byHand = await createAs(t, undefined, "by hand", "notes");

      const authorOf = async (entryId: string) => {
        const rows = await t
          .getService("versionsService")
          .list(
            { scopeKind: "collection", scopeSlug: "notes", entryId },
            { limit: 5 }
          );
        const [row] = await attachVersionAuthors(rows);
        return row?.author;
      };
      expect(await authorOf(byAgent)).toMatchObject({
        kind: "person",
        id: PERSON.id,
        name: PERSON.name,
        agentName: "Claude Code",
      });
      // The person's own save names them alone.
      const own = await authorOf(byHand);
      expect(own).toMatchObject({ kind: "person", name: PERSON.name });
      expect(own?.agentName ?? null).toBeNull();
    });

    it("records the approval on the row it let run", async () => {
      const t = await boot(dialect);
      const attribution: ActorAttribution = {
        door: "command",
        agent: { name: "Claude Code", sessionId: SESSION_ID },
        credentialId: PASS_ID,
        approval: { requestId: "req-1", approvedBy: APPROVER, via: "phone" },
      };
      await createAs(t, attribution);
      await auditWriter(t).write({
        kind: "role-assigned",
        actorUserId: PERSON.id,
        attribution,
      });

      for (const row of [(await activityRows(t))[0], (await auditRows(t))[0]]) {
        expect(row).toMatchObject({
          approvalRequestId: "req-1",
          approvedByUserId: APPROVER,
          approvedVia: "phone",
          grantId: null,
          undoesSessionId: null,
        });
      }
    });

    it("records the standing grant on the row it let run unasked", async () => {
      const t = await boot(dialect);
      await createAs(t, {
        door: "chat-app",
        agent: { name: "ChatGPT", sessionId: SESSION_ID },
        credentialId: PASS_ID,
        grantId: "grant-7",
      });
      const [row] = await activityRows(t);
      expect(row).toMatchObject({
        agentName: "ChatGPT",
        grantId: "grant-7",
        approvalRequestId: null,
      });
    });

    it("records which agent session an undo puts back, as the person's own work", async () => {
      const t = await boot(dialect);
      // The undo is the person's: no agent acted on this row.
      await createAs(t, { door: "command", undoesSessionId: SESSION_ID });
      const [row] = await activityRows(t);
      expect(row).toMatchObject({
        userId: PERSON.id,
        agentName: null,
        undoesSessionId: SESSION_ID,
      });
    });

    it("records the local owner's work at the command line through the local door, with no agent", async () => {
      const t = await boot(dialect);
      await createAs(t, { door: "local" });
      const [row] = await activityRows(t);
      expect(row).toMatchObject({
        userId: PERSON.id,
        userName: PERSON.name,
        door: "local",
        agentName: null,
        credentialId: null,
      });
    });

    it("records a deployment's run by host and commit, on both trails", async () => {
      const t = await boot(dialect);
      const attribution: ActorAttribution = {
        deployment: { pipeline: "Vercel build", commit: "3F2A1C9" },
      };
      await container
        .get<ActivityLogService>("activityLogService")
        .logActivityOrThrow({
          actorType: "system",
          userId: "deployment",
          action: "update",
          collection: "posts",
          attribution,
        });
      await auditWriter(t).write({
        kind: "login-succeeded",
        actorKind: "core",
        attribution,
      });

      const [activity] = await activityRows(t);
      expect(activity).toMatchObject({
        actorType: "system",
        userId: "deployment",
        door: "deploy",
        deploymentHost: "Vercel build",
        deploymentCommit: "3f2a1c9",
        agentName: null,
      });
      const [audit] = await auditRows(t);
      expect(audit).toMatchObject({
        actorKind: "core",
        door: "deploy",
        deploymentHost: "Vercel build",
        deploymentCommit: "3f2a1c9",
      });
    });

    it("stores no token in any row, and keeps the rest of the row", async () => {
      const t = await boot(dialect);
      const attribution: ActorAttribution = {
        door: "rest-key",
        agent: { name: "Cursor", sessionId: TOKEN },
        credentialId: TOKEN,
        approval: { requestId: TOKEN, approvedBy: APPROVER, via: "browser" },
        grantId: TOKEN,
      };
      await createAs(t, attribution);
      await auditWriter(t).write({
        kind: "login-succeeded",
        actorUserId: PERSON.id,
        attribution,
      });

      for (const table of [
        "activity_log",
        "audit_log",
        "nextly_content_events",
      ]) {
        const values = await everyStoredValue(t, table);
        expect(values.length).toBeGreaterThan(0);
        expect(values.filter(value => value.includes(TOKEN))).toEqual([]);
      }
      // The row was still written, with every part that was not a token.
      const [activity] = await activityRows(t);
      expect(activity).toMatchObject({
        userId: PERSON.id,
        agentName: "Cursor",
        door: "rest-key",
        approvedByUserId: APPROVER,
        approvedVia: "browser",
        credentialId: null,
        agentSessionId: null,
        grantId: null,
      });
      const [audit] = await auditRows(t);
      expect(audit).toMatchObject({ agentName: "Cursor", credentialId: null });
    });

    it("narrows the feed to one agent, or to one agent session", async () => {
      const t = await boot(dialect);
      const claude = (sessionId: string): ActorAttribution => ({
        door: "command",
        agent: { name: "Claude Code", sessionId },
        credentialId: PASS_ID,
      });
      await createAs(t, claude(SESSION_ID), "first session");
      await createAs(
        t,
        claude("d4e6f8a0-2b3c-4d5e-9f7a-1b2c3d4e5f6a"),
        "second session"
      );
      await createAs(
        t,
        { door: "chat-app", agent: { name: "ChatGPT", sessionId: "s-gpt" } },
        "another agent"
      );
      await createAs(t, undefined, "by hand");
      // The feed authorizes each row's document as its reader: the person
      // reads the collection by a grant, as a reader on a real site would.
      await grantTo(t, PERSON.id, "read", ["posts"]);

      const feed = (filters: { agentName?: string; agentSessionId?: string }) =>
        t
          .getService("activityLogService")
          .getRecentActivity({
            ...filters,
            limit: 20,
            scope: allResources(),
            caller: { user: { id: PERSON.id, roles: [] } },
          })
          .then(result =>
            result.activities.map(row => [row.entryTitle, row.agentName])
          );

      expect((await feed({})).length).toBe(4);
      expect((await feed({ agentName: "Claude Code" })).sort()).toEqual([
        ["first session", "Claude Code"],
        ["second session", "Claude Code"],
      ]);
      expect(await feed({ agentSessionId: SESSION_ID })).toEqual([
        ["first session", "Claude Code"],
      ]);
      // Each row says who stood behind it, as the readers draw it.
      const [row] = (
        await t.getService("activityLogService").getRecentActivity({
          agentName: "ChatGPT",
          scope: allResources(),
          caller: { user: { id: PERSON.id, roles: [] } },
        })
      ).activities;
      expect(row).toMatchObject({
        userName: PERSON.name,
        agentName: "ChatGPT",
        door: "chat-app",
        approvedVia: null,
      });
    });

    it("drops a token passed as an agent's name, on every trail, and still writes the row", async () => {
      const t = await boot(dialect);
      const attribution: ActorAttribution = {
        door: "command",
        agent: { name: TOKEN, sessionId: SESSION_ID },
        credentialId: PASS_ID,
      };
      await createAs(t, attribution);
      await auditWriter(t).write({
        kind: "login-succeeded",
        actorUserId: PERSON.id,
        attribution,
      });

      for (const table of [
        "activity_log",
        "audit_log",
        "nextly_content_events",
      ]) {
        const values = await everyStoredValue(t, table);
        expect(values.length).toBeGreaterThan(0);
        expect(values.filter(value => value.includes(TOKEN))).toEqual([]);
      }
      const [activity] = await activityRows(t);
      expect(activity).toMatchObject({
        userId: PERSON.id,
        userName: PERSON.name,
        agentName: null,
        door: "command",
        agentSessionId: SESSION_ID,
      });
    });

    it("still records no activity row for a plugin-defined person's write", async () => {
      // The activity recorder now takes the request's own actor rather than
      // the webhook envelope's copy, which made a person into `system`. A
      // person carries no id, so the recorder skips them exactly as it
      // skipped `system`: their write leaves the trail as it did.
      current = await createTestNextly({
        dialect,
        plugins: [MEMBERS],
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const t = current;
      const member = await t.nextly.principals.byId("members:member", "m1");
      if (!member) throw new Error("no member m1");

      await runAsPrincipal(member, () =>
        t
          .getService("collectionsHandler")
          .createEntry(
            { collectionName: "posts", overrideAccess: true },
            { title: "by a member" }
          )
      );

      // The write happened, and its history names the person...
      const events = await t.adapter.select<EventRow>("nextly_content_events");
      expect(events.map(e => e.actorKind)).toEqual(["principal"]);
      // ...and the activity log has nothing for it, as before.
      expect(await activityRows(t)).toEqual([]);
    });
  }
);

/** A plugin defining one kind of signed-in person, for the person's write. */
const MEMBERS = {
  name: "members",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "member",
        attributes: {},
        resolve: async () => null,
        lookup: async (id: string) => ({ id, attributes: {} }),
      },
    ],
  },
} as unknown as PluginDefinition;
