/**
 * What a submission's notifications did, kept by the plugin and read through
 * its routes, and Resend, on every configured dialect:
 *
 * - each recipient's result is recorded as the send changes: waiting,
 *   sending, sent after a retry, failed, a recipient accepted beside one
 *   refused, and cancelled by a person, by marking Spam or by an erasure;
 * - the record outlives core's queued email and delivery log, and does not
 *   change when the visitor's answer is edited after the send;
 * - Resend sends only to recipients not yet reached, plus any ticked, after a
 *   stop between the provider's acceptance and its record, when a send filter
 *   adds a recipient, and to a copied recipient alone; it retires a failed
 *   original whose message is held, is refused while a send is in progress,
 *   and needs both updating submissions and managing email deliveries.
 *
 * Reached recipients are left out by the plugin's own keyed digest, which
 * core keeps the same across rotations of the install's secret; core's
 * `plugin-send-outcomes` suite rotates the secret and proves it.
 *
 * The provider is a real one that captures, fails, refuses or holds as each
 * case says. It takes one `to` per message, so a send to the team's two
 * addresses is two calls.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  defineEmailProvider,
  definePlugin,
  type PluginEmailTemplate,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  type EmailPayloadFilterValue,
  getFilterRegistry,
  runJobsPass,
  ServiceContainer,
} from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { FORM_SUBMISSION_TEMPLATE } from "../emails/starter-messages";
import { formBuilder } from "../plugin";
import {
  notificationLook,
  recipientLook,
  type RecipientStatus,
} from "../utils/send-status";

const SUBMISSIONS = "form-submissions";
const TEAM = "team@example.com";
const OPS = "ops@example.com";
const ADA = "ada@example.com";
const AUDIT = "audit@example.com";
const PLUGIN = "@nextlyhq/plugin-form-builder";

/** Every call the provider was handed, by its lines. */
const calls: Array<{ to: string[]; cc: string[]; bcc: string[] }> = [];

/** A promise and the function that settles it. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
}

/** What the provider does with its next calls. */
const behaviour: {
  failures: number;
  /** Mailboxes the provider refuses, for good. */
  refuse: Set<string>;
  gate?: Promise<void>;
  reached?: () => void;
  /** The plugin's record of a sent change fails once, as a stop would. */
  stopOnce: boolean;
} = { failures: 0, refuse: new Set(), stopOnce: false };

const list = (value: unknown): string[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? (value as string[])
      : [value as string];

const mailer = definePlugin({
  name: "@test/history-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "history-mailer",
        label: "History mailer",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (opts: { to: unknown; cc?: unknown; bcc?: unknown }) => {
            const call = {
              to: list(opts.to),
              cc: list(opts.cc),
              bcc: list(opts.bcc),
            };
            calls.push(call);
            if (behaviour.gate) {
              behaviour.reached?.();
              await behaviour.gate;
            }
            if (behaviour.failures > 0) {
              behaviour.failures -= 1;
              throw new Error("provider down");
            }
            if (call.to.every(address => behaviour.refuse.has(address))) {
              // Classified by the provider: no retry can help.
              throw Object.assign(new Error("refused"), {
                emailFailure: { retryable: false, reason: "Refused." },
              });
            }
            const rejected = [...call.cc, ...call.bcc].filter(address =>
              behaviour.refuse.has(address)
            );
            return {
              success: true,
              messageId: `captured-${calls.length}`,
              ...(rejected.length > 0 ? { rejected } : {}),
            };
          },
        }),
      }),
    ],
  },
  init(ctx: {
    hooks: {
      on: (
        type: string,
        slug: string,
        handler: (context: unknown) => unknown
      ) => void;
    };
  }) {
    // A stop between the provider's acceptance and the plugin's record of
    // it: the change's transaction fails once, as a crash there would.
    ctx.hooks.on("beforeUpdate", "form-submission-sends", context => {
      const data = (context as { data?: { state?: unknown } }).data;
      if (behaviour.stopOnce && data?.state === "sent") {
        behaviour.stopOnce = false;
        throw new Error("stopped before the record committed");
      }
      return data;
    });
  },
} as never);

let current: TestNextly | undefined;
afterEach(async () => {
  calls.length = 0;
  behaviour.failures = 0;
  behaviour.refuse = new Set();
  behaviour.gate = undefined;
  behaviour.reached = undefined;
  behaviour.stopOnce = false;
  const instance = current;
  current = undefined;
  await instance?.destroy();
});

/** The part of the email template service a boot uses to seed owners' templates. */
interface TemplateOwners {
  configureOwnership(input: {
    plugins: Array<{ name: string; templates: readonly PluginEmailTemplate[] }>;
  }): void;
  ensureBuiltInTemplates(): Promise<void>;
}

/** The team's notification, to two addresses. */
const team = {
  id: "team",
  name: "Team",
  enabled: true,
  recipientType: "static",
  to: TEAM,
  recipients: [TEAM, OPS],
  cc: [],
  bcc: [],
  templateSlug: FORM_SUBMISSION_TEMPLATE,
};

/** The visitor's confirmation, copied to the team. */
const visitor = {
  id: "visitor",
  name: "Confirmation",
  enabled: true,
  recipientType: "field",
  to: "{{email}}",
  cc: [TEAM],
  bcc: [],
  templateSlug: FORM_SUBMISSION_TEMPLATE,
};

async function boot(
  dialect: TestDialect,
  notifications: Array<Record<string, unknown>> = [team]
) {
  const fb = formBuilder();
  current = await createTestNextly({ dialect, plugins: [fb.plugin, mailer] });
  const t = current;
  const owners = t.getService(
    "emailTemplateService"
  ) as unknown as TemplateOwners;
  owners.configureOwnership({
    plugins: [
      {
        name: fb.plugin.name,
        templates: fb.plugin.contributes?.emailTemplates ?? [],
      },
    ],
  });
  await owners.ensureBuiltInTemplates();
  await t.nextly.emailProviders.create({
    data: {
      name: "History",
      type: "history-mailer",
      fromEmail: "from@example.com",
      configuration: {},
      isDefault: true,
    },
  } as never);
  // What a real start seeds, which the harness does not.
  const seeder = t.getService("permissionSeedService") as unknown as {
    seedSystemPermissions: () => Promise<unknown>;
    seedAllCollectionPermissions: () => Promise<unknown>;
  };
  await seeder.seedSystemPermissions();
  await seeder.seedAllCollectionPermissions();
  // The instance's first user is its super admin.
  const owner = await person(t, "owner");
  const form = await t.nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: [
        { type: "text", name: "message", label: "Message" },
        { type: "email", name: "email", label: "Email" },
      ],
      notifications,
    },
  });
  const formId = String(form.item.id);
  const submit = async (data: Record<string, unknown> = {}) =>
    String(
      (
        await t.nextly.create({
          collection: SUBMISSIONS,
          data: {
            form: formId,
            data: { message: "hello", email: ADA, ...data },
            status: "new",
            submittedAt: new Date(),
          },
        })
      ).item.id
    );
  return { t, formId, owner, submit };
}

async function person(t: TestNextly, name: string): Promise<string> {
  const created = await t.nextly.users.create({
    email: `${name}@example.com`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  return created.item.id;
}

/** How many roles `grant` has made, numbering the next. */
let roles = 0;

/** Gives `userId` a role holding exactly the permissions named. */
async function grant(t: TestNextly, userId: string, slugs: string[]) {
  const permissions = await t.nextly.permissions.find({ limit: 1000 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  roles += 1;
  const role = await t.nextly.roles.create({
    data: { name: `Role ${roles}`, slug: `r-${roles}`, permissionIds: ids },
  });
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(userId, role.item.id);
  expect(assigned.success).toBe(true);
}

async function sessionOf(t: TestNextly, userId: string): Promise<string> {
  const user = await t.nextly.users.findByID({ id: userId });
  if (user === null) throw new Error(`no user ${userId}`);
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: user.email,
      name: user.name ?? "",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** A plugin route, through core's handler, as `cookie`'s person. */
async function route(
  path: string,
  cookie: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<Response> {
  const segments = ["plugins", PLUGIN, ...path.split("?")[0]!.split("/")];
  const search = path.includes("?") ? `?${path.split("?")[1]}` : "";
  const method = init.method ?? "GET";
  const request = new Request(
    `http://localhost/api/${segments.join("/")}${search}`,
    {
      method,
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }
  );
  return createDynamicHandlers()[method](request, {
    params: Promise.resolve({ params: segments }),
  });
}

interface SendsItem {
  notification: string | null;
  name: string;
  recipients: RecipientStatus[];
  inProgress: boolean;
  sends: Array<{
    queuedId: string;
    state: string;
    attempts: number;
    requestedBy: string | null;
    retired: boolean;
  }>;
  addressable: Array<{ digest: string; hint: string; reached: boolean }>;
}

/** A submission's sends, as its page reads them. */
async function sendsOf(
  t: TestNextly,
  cookie: string,
  id: string
): Promise<SendsItem[]> {
  const response = await route(`submissions/${id}/sends`, cookie);
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { items: SendsItem[] }).items;
}

/** One notification's group of a submission's sends. */
async function groupOf(
  t: TestNextly,
  cookie: string,
  id: string,
  notification = "team"
): Promise<SendsItem> {
  const group = (await sendsOf(t, cookie, id)).find(
    item => item.notification === notification
  );
  if (!group) throw new Error(`no sends of ${notification}`);
  return group;
}

/** Each recipient's status in words, by hint. */
const looks = (group: SendsItem) =>
  Object.fromEntries(
    group.recipients.map(recipient => [
      recipient.hint,
      recipientLook(recipient).label,
    ])
  );

const resend = (
  cookie: string,
  id: string,
  body: { notification: string; tick?: string[] }
) => route(`submissions/${id}/resend`, cookie, { method: "POST", body });

/** One jobs trigger, `ahead` past now. */
function trigger(t: TestNextly, ahead = 2 * 60 * 60_000) {
  return runJobsPass(t.adapter as never, t.getService("jobRegistry" as never), {
    now: () => new Date(Date.now() + ahead),
  });
}

describe.each(getConfiguredTestDialects())(
  "a submission's sends, kept and sent again (%s)",
  dialect => {
    it("keeps each recipient as Sent, or Sent after a retry, as the provider took it", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      // The first call, the team's, fails; the second, ops', is taken.
      behaviour.failures = 1;
      const id = await submit();
      expect(looks(await groupOf(t, cookie, id))).toEqual({
        "t•••@example.com": "Retrying",
        "o•••@example.com": "Sent",
      });

      await trigger(t);

      const group = await groupOf(t, cookie, id);
      expect(looks(group)).toEqual({
        "t•••@example.com": "Sent after 1 retry",
        "o•••@example.com": "Sent",
      });
      expect(notificationLook(group.recipients).label).toBe(
        "Sent after 1 retry"
      );
      expect(group.sends).toEqual([
        expect.objectContaining({ state: "sent", attempts: 2 }),
      ]);
      // Hints and digests only: no address leaves the route.
      expect(JSON.stringify(group)).not.toContain(TEAM);
      expect(JSON.stringify(group)).not.toContain(OPS);
    });

    it("reads a recipient accepted beside one refused as Partly sent", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();

      const group = await groupOf(t, cookie, id);
      expect(looks(group)).toEqual({
        "t•••@example.com": "Sent",
        "o•••@example.com": "Failed",
      });
      expect(notificationLook(group.recipients).label).toBe("Partly sent");
    });

    it("says Sending while an attempt is with the provider, and refuses Resend then", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const arrived = latch();
      const held = latch();
      behaviour.gate = held.promise;
      behaviour.reached = arrived.open;
      const submitting = submit();
      await arrived.promise;
      const { items } = await t.nextly.find({ collection: SUBMISSIONS });
      const id = String((items[0] as { id: unknown }).id);

      const group = await groupOf(t, cookie, id);
      expect(group.inProgress).toBe(true);
      expect(Object.values(looks(group))).toEqual(["Sending", "Sending"]);
      const refused = await resend(cookie, id, { notification: "team" });
      expect(refused.status).toBe(409);

      behaviour.gate = undefined;
      held.open();
      await submitting;
      expect((await groupOf(t, cookie, id)).inProgress).toBe(false);
    });

    it("keeps why a send was cancelled: by a person, by marking Spam, by an erasure", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const [byPerson, bySpam, byErasure] = [
        await submit(),
        await submit(),
        await submit({ email: "erase-me@example.com" }),
      ];

      const [queued] = (await groupOf(t, cookie, byPerson)).sends;
      await t.nextly.email.cancelQueued({
        id: queued!.queuedId,
        user: { id: owner },
        overrideAccess: false,
      } as never);
      await t.nextly.update({
        collection: SUBMISSIONS,
        id: bySpam,
        data: { status: "spam", _overwrite: true },
      });
      await t.getService("emailDeliveryService").eraseRecipient(TEAM);

      const causeOf = async (id: string) =>
        (await groupOf(t, cookie, id)).recipients.map(
          recipient => recipient.cancel?.by
        );
      expect(await causeOf(byPerson)).toEqual(["person", "person"]);
      expect(await causeOf(bySpam)).toEqual(["spam", "spam"]);
      expect(await causeOf(byErasure)).toEqual(["erasure", "erasure"]);
    });

    it("keeps the record past the delivery log's 90 days, unchanged by an edited answer", async () => {
      const { t, owner, submit } = await boot(dialect, [visitor]);
      const cookie = await sessionOf(t, owner);
      // The copy to the team refused, so the record holds a failure that
      // nothing in core's records is left to explain.
      behaviour.refuse = new Set([TEAM]);
      const id = await submit();
      const before = await groupOf(t, cookie, id, "visitor");
      expect(looks(before)).toEqual({
        "a•••@example.com": "Sent",
        "t•••@example.com": "Failed",
      });

      await t.nextly.update({
        collection: SUBMISSIONS,
        id,
        data: {
          data: { message: "hello", email: "grace@example.org" },
          _overwrite: true,
        },
      });
      // Core's queued email and delivery records, gone as its sweeps leave
      // them past 90 days.
      await trigger(t, 91 * 24 * 60 * 60_000);
      await t.adapter.delete("email_deliveries", {});
      await t.adapter.delete("email_queue", {});
      expect(await t.adapter.select("email_queue", {})).toEqual([]);

      const after = await groupOf(t, cookie, id, "visitor");
      expect(after.recipients).toEqual(before.recipients);
      // The address it can reach now is the edited one, not yet reached.
      expect(after.addressable).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hint: "g•••@example.org", reached: false }),
        ])
      );
    });

    it("sends again only to the recipient who missed it, plus one ticked, and records who asked", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();

      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );
      expect(calls.slice(2).map(call => call.to)).toEqual([[OPS]]);

      const group = await groupOf(t, cookie, id);
      expect(looks(group)).toEqual({
        "t•••@example.com": "Sent",
        "o•••@example.com": "Sent",
      });
      expect(group.sends[1]).toMatchObject({ requestedBy: owner });

      const teamDigest = group.addressable.find(
        recipient => recipient.hint === "t•••@example.com"
      )!.digest;
      expect(
        (await resend(cookie, id, { notification: "team", tick: [teamDigest] }))
          .status
      ).toBe(201);
      expect(calls.slice(3).map(call => call.to)).toEqual([[TEAM]]);
      // Nobody left who missed it, and nobody ticked: refused.
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        409
      );
    });

    it("treats a send stopped between the provider's acceptance and its record as in progress, then reached", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.stopOnce = true;
      const id = await submit();
      expect(calls).toHaveLength(2);

      const stopped = await groupOf(t, cookie, id);
      expect(stopped.inProgress).toBe(true);
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        409
      );

      await trigger(t);

      expect(looks(await groupOf(t, cookie, id))).toEqual({
        "t•••@example.com": "Sent",
        "o•••@example.com": "Sent",
      });
      // Everyone reached: nothing to send again, and nothing was sent twice.
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        409
      );
      expect(calls).toHaveLength(2);
    });

    it("leaves out a recipient a send filter added once it has received it", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const addAudit = (value: EmailPayloadFilterValue) => ({
        ...value,
        bcc: [...(value.bcc ?? []), AUDIT],
      });
      getFilterRegistry().addFilter("email.beforeSend", addAudit);
      try {
        behaviour.refuse = new Set([OPS]);
        const id = await submit();
        behaviour.refuse = new Set();
        const added = (await groupOf(t, cookie, id)).recipients.find(
          recipient => recipient.source === "added"
        );
        expect(added).toMatchObject({
          hint: "a•••@example.com",
          state: "sent",
        });

        expect(
          (await resend(cookie, id, { notification: "team" })).status
        ).toBe(201);
        expect(calls.slice(2)).toEqual([{ to: [OPS], cc: [], bcc: [] }]);
      } finally {
        getFilterRegistry().removeFilter("email.beforeSend", addAudit);
      }
    });

    it("sends again to a recipient a send filter added who missed it", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const addAudit = (value: EmailPayloadFilterValue) => ({
        ...value,
        bcc: [...(value.bcc ?? []), AUDIT],
      });
      getFilterRegistry().addFilter("email.beforeSend", addAudit);
      try {
        behaviour.refuse = new Set([AUDIT]);
        const id = await submit();
        behaviour.refuse = new Set();
        // Offered on the page, though the notification does not name it.
        expect((await groupOf(t, cookie, id)).addressable).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              hint: "a•••@example.com",
              source: "added",
              reached: false,
            }),
          ])
        );

        const before = calls.length;
        expect(
          (await resend(cookie, id, { notification: "team" })).status
        ).toBe(201);
        expect(calls.slice(before)).toEqual([{ to: [AUDIT], cc: [], bcc: [] }]);
      } finally {
        getFilterRegistry().removeFilter("email.beforeSend", addAudit);
      }
    });

    it("leaves out who another resend reached since the plan was made", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();
      const first = await groupOf(t, cookie, id);
      const teamDigest = first.addressable.find(
        recipient => recipient.hint === "t•••@example.com"
      )!.digest;
      // A plan made while ops had not received it: only the team left out.
      const stale = {
        submission: id,
        notification: "team",
        exclude: [teamDigest],
        ticked: [],
        retire: [],
        settled: first.sends.map(send => send.queuedId),
      };
      // Another resend reaches ops before that plan is stored.
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );
      const before = calls.length;

      await expect(
        t.nextly.create({ collection: "form-submission-resends", data: stale })
      ).rejects.toThrow();
      expect(calls).toHaveLength(before);
    });

    it("refuses a resend stored after the submission was marked Spam", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();
      const first = await groupOf(t, cookie, id);
      // The route planned it while the submission was not Spam...
      const plan = {
        submission: id,
        notification: "team",
        ticked: [],
        retire: [],
        settled: first.sends.map(send => send.queuedId),
      };
      // ...then it was marked Spam before the request was stored.
      await t.nextly.update({
        collection: SUBMISSIONS,
        id,
        data: { status: "spam", _overwrite: true },
      });
      const before = calls.length;

      await expect(
        t.nextly.create({ collection: "form-submission-resends", data: plan })
      ).rejects.toThrow();
      expect(calls).toHaveLength(before);
    });

    it("does not list a send recorded before the history was kept", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const id = await submit();
      const listed = await sendsOf(t, cookie, id);
      // As an earlier version recorded a send: no notification, no recipients.
      await t.nextly.create({
        collection: "form-submission-sends",
        data: { submission: id, queuedId: "q-before", sendKey: "k-before" },
      });

      expect(await sendsOf(t, cookie, id)).toEqual(listed);
    });

    it("keeps a recipient a cancelled resend left out as received", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();

      // The resend's attempts fail until it is cancelled, so it never
      // reports its recipients.
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );
      const resent = (await groupOf(t, cookie, id)).sends.at(-1)!;
      await t.nextly.email.cancelQueued({
        id: resent.queuedId,
        user: { id: owner },
        overrideAccess: false,
      } as never);
      behaviour.failures = 0;

      expect(looks(await groupOf(t, cookie, id))).toEqual({
        "t•••@example.com": "Sent",
        "o•••@example.com": "Cancelled",
      });
      const before = calls.length;
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );
      expect(calls.slice(before).map(call => call.to)).toEqual([[OPS]]);
    });

    it("records the recipients a resend leaves out as skipped, before any attempt", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();
      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );

      const { items } = await t.nextly.find({
        collection: "form-submission-sends",
        where: { resend: { exists: true } },
      });
      const [stored] = items as Array<{
        configured: Array<{ hint: string; outcome?: string }>;
      }>;
      // What a cancel before the first attempt would leave to read: the
      // team, who had it, is not taken as sent to again.
      expect(
        stored!.configured.map(recipient => [recipient.hint, recipient.outcome])
      ).toEqual([
        ["t•••@example.com", "skipped"],
        ["o•••@example.com", undefined],
      ]);
    });

    it("sends a copied recipient who missed it a message of its own", async () => {
      const { t, owner, submit } = await boot(dialect, [visitor]);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([TEAM]);
      const id = await submit();
      behaviour.refuse = new Set();

      expect(
        (await resend(cookie, id, { notification: "visitor" })).status
      ).toBe(201);
      expect(calls.slice(1)).toEqual([{ to: [TEAM], cc: [], bcc: [] }]);
    });

    it("retires a failed original whose message is held, so a retry of it sends nothing", async () => {
      const { t, owner, submit } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      behaviour.refuse = new Set([TEAM, OPS]);
      const id = await submit();
      const [original] = (await groupOf(t, cookie, id)).sends;
      expect(original).toMatchObject({ state: "failed" });
      behaviour.refuse = new Set();

      expect((await resend(cookie, id, { notification: "team" })).status).toBe(
        201
      );

      const group = await groupOf(t, cookie, id);
      expect(group.sends[0]).toMatchObject({ state: "failed", retired: true });
      const [row] = await t.adapter.select<{ message: string | null }>(
        "email_queue",
        {
          where: {
            and: [{ column: "id", op: "=", value: original!.queuedId }],
          },
        }
      );
      expect(row?.message).toBeNull();
      const sent = calls.length;
      await trigger(t);
      expect(calls).toHaveLength(sent);
    });

    it("needs both updating submissions and managing email deliveries", async () => {
      const { t, submit } = await boot(dialect);
      behaviour.refuse = new Set([OPS]);
      const id = await submit();
      behaviour.refuse = new Set();
      const [updater, manager, both] = [
        await person(t, "updater"),
        await person(t, "manager"),
        await person(t, "both"),
      ];
      await grant(t, updater, [
        "read-form-submissions",
        "update-form-submissions",
      ]);
      await grant(t, manager, [
        "read-form-submissions",
        "manage-email-deliveries",
      ]);
      await grant(t, both, [
        "read-form-submissions",
        "update-form-submissions",
        "manage-email-deliveries",
      ]);

      const asked = async (userId: string) =>
        (
          await resend(await sessionOf(t, userId), id, {
            notification: "team",
          })
        ).status;
      expect(await asked(updater)).toBe(403);
      expect(await asked(manager)).toBe(403);
      expect(calls).toHaveLength(2);
      expect(await asked(both)).toBe(201);
      expect(calls).toHaveLength(3);
    });
  }
);
