/**
 * The email that copies a release notice, and the overdue notice's text.
 *
 * An email has no reader's zone, so the instant is written in the zone the
 * release was scheduled in, and named. The link is the notice's own, made
 * absolute only with the public origin the site sets: a guessed host would
 * send the owner to a page that is not theirs. And the email is sent under
 * the notice's key with the same message on every run of its job, so a repeat
 * is answered from the first send rather than refused as a different message.
 * It goes only to a person the notice itself still shows to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const site = vi.hoisted(() => ({
  origin: null as string | null,
  releases: new Set<string>(),
  /** Whether the notice's person may still read releases. */
  mayRead: true,
}));

// The origin is read from an environment validated once on import, so it is
// stubbed where it is read.
vi.mock("../../../shared/lib/get-base-url", () => ({
  getPublicOrigin: () => site.origin,
}));
// The links are read from the registered adapter; here, from the releases the
// case says exist, by the same page path.
vi.mock("../release-notice-links", () => ({
  releaseNoticeLinks: async (ids: readonly string[]) =>
    new Map(
      ids
        .filter(id => site.releases.has(id))
        .map(id => [id, `/admin/releases/${id}`])
    ),
  mayReadReleaseNotices: async () => site.mayRead,
}));

const { emailReleaseNotice, releaseNoticeEmailKey, releaseNoticeMessage } =
  await import("../release-notice-email");
const { RELEASE_OVERDUE_NOTICE } = await import("../release-overdue-notice");
const { RELEASE_STOPPED_NOTICE } = await import("../release-stopped-notice");
const { clearNoticeKindsForTests, registerNoticeKind } = await import(
  "../../notices/notice-kinds"
);
const { NOTICES_TABLE } = await import("../../../schemas/notices/table-name");
type NoticesDb = import("../../notices/notices-service").NoticesDb;
type QueueOptions = Parameters<
  import("../../email/services/email-service").EmailService["queue"]
>[0];

// Registered as the releases feature registers them, since the email shows a
// notice only as the person's own list would.
beforeEach(() => {
  registerNoticeKind(RELEASE_STOPPED_NOTICE);
  registerNoticeKind(RELEASE_OVERDUE_NOTICE);
});

afterEach(() => {
  site.origin = null;
  site.releases.clear();
  site.mayRead = true;
  clearNoticeKindsForTests();
});

const NOTICE = {
  id: "n1",
  userId: "owner",
  kind: "releases.overdue",
  subjectId: "r1",
  data: {
    title: "Spring launch",
    scheduledAt: "2026-10-29T09:00:00.000Z",
    timezone: "Asia/Karachi",
    ranAt: null,
  },
};

/**
 * A database holding one notice and its person's address. A person who is
 * not active is found only by a read that does not ask for an active one.
 */
function holding(
  notice: typeof NOTICE | null,
  email: string | null,
  active = true
) {
  return {
    dialect: "postgresql",
    tableExists: async () => true,
    select: async (
      table: string,
      query?: { where?: { and: Array<{ column: string; value?: unknown }> } }
    ) => {
      if (table === NOTICES_TABLE) return notice === null ? [] : [notice];
      const asksActive = (query?.where?.and ?? []).some(
        condition => condition.column === "isActive" && condition.value === true
      );
      return email === null || (asksActive && !active) ? [] : [{ email }];
    },
  } as unknown as NoticesDb;
}

function sender(configured = true) {
  return {
    isConfigured: vi.fn(async () => configured),
    queue: vi.fn(async (_options: QueueOptions) => ({
      id: "queued",
      state: "waiting" as const,
    })),
  };
}

describe("the instant a release notice's email writes", () => {
  it("is in the zone the release was scheduled in, named", () => {
    const message = releaseNoticeMessage({
      text: { title: "“Spring launch” stopped" },
      scheduledAt: "2026-10-29T09:00:00.000Z",
      timezone: "Asia/Karachi",
      url: null,
    });
    // 09:00 UTC is 14:00 in Karachi.
    expect(message.plainText).toContain(
      "It was scheduled for Thursday, 29 October 2026 at 14:00 (Asia/Karachi)."
    );
  });

  it("is in UTC, named, where the release has no zone or one the platform does not know", () => {
    for (const timezone of [null, "Not/A_Zone"]) {
      const message = releaseNoticeMessage({
        text: { title: "“Spring launch” stopped" },
        scheduledAt: "2026-10-29T09:00:00.000Z",
        timezone,
        url: null,
      });
      expect(message.plainText).toContain("at 09:00 (UTC).");
    }
  });
});

describe("a release notice's email", () => {
  it("escapes the title in its HTML, and keeps its subject on one line", () => {
    const message = releaseNoticeMessage({
      text: { title: "<b>Sale</b> & more\nBcc: x@example.com" },
      scheduledAt: null,
      timezone: null,
      url: "https://site.example/admin/releases/r1?a=1&b=2",
    });
    expect(message.html).toContain(
      "&lt;b&gt;Sale&lt;/b&gt; &amp; more\nBcc: x@example.com"
    );
    expect(message.html).not.toContain("<b>Sale</b>");
    expect(message.html).toContain(
      'href="https://site.example/admin/releases/r1?a=1&amp;b=2"'
    );
    expect(message.subject).toBe("<b>Sale</b> & more Bcc: x@example.com");
  });

  it("links to the release only where the site sets its public origin", async () => {
    site.releases.add("r1");
    const withOrigin = sender();
    site.origin = "https://site.example";
    await emailReleaseNotice(
      { db: holding(NOTICE, "owner@example.com"), email: withOrigin },
      "n1"
    );
    const withoutOrigin = sender();
    site.origin = null;
    await emailReleaseNotice(
      { db: holding(NOTICE, "owner@example.com"), email: withoutOrigin },
      "n1"
    );

    const linked = withOrigin.queue.mock.calls[0][0];
    expect(linked.plainText).toContain(
      "Open the release: https://site.example/admin/releases/r1"
    );
    expect(linked.html).toContain(
      '<a href="https://site.example/admin/releases/r1">'
    );
    const unlinked = withoutOrigin.queue.mock.calls[0][0];
    expect(unlinked.plainText).not.toContain("Open the release");
    expect(unlinked.html).not.toContain("<a ");
  });

  it("says the release is gone, with no link, once it has been deleted", async () => {
    site.origin = "https://site.example";
    const email = sender();
    await emailReleaseNotice(
      { db: holding(NOTICE, "owner@example.com"), email },
      "n1"
    );
    const message = email.queue.mock.calls[0][0];
    expect(message.plainText).toContain("The release has since been deleted.");
    expect(message.plainText).not.toContain("Open the release");
  });

  it("is sent to its person, under the notice's key, with the same message on every run", async () => {
    site.releases.add("r1");
    const email = sender();
    const deps = { db: holding(NOTICE, "owner@example.com"), email };
    await emailReleaseNotice(deps, "n1");
    await emailReleaseNotice(deps, "n1");

    expect(email.queue).toHaveBeenCalledTimes(2);
    expect(email.queue.mock.calls[0][0]).toMatchObject({
      to: "owner@example.com",
      subject: "“Spring launch” missed its time",
      person: { kind: "staff", id: "owner" },
      idempotencyKey: releaseNoticeEmailKey("n1"),
    });
    expect(email.queue.mock.calls[1][0]).toEqual(email.queue.mock.calls[0][0]);
  });

  it("is not queued to a person who may no longer read releases, whose list hides the notice", async () => {
    site.releases.add("r1");
    site.mayRead = false;
    const email = sender();

    expect(
      await emailReleaseNotice(
        { db: holding(NOTICE, "owner@example.com"), email },
        "n1"
      )
    ).toBeNull();
    expect(email.queue).not.toHaveBeenCalled();
  });

  it("is not queued to a person deactivated since, who keeps their roles", async () => {
    site.releases.add("r1");
    const email = sender();

    expect(
      await emailReleaseNotice(
        { db: holding(NOTICE, "owner@example.com", false), email },
        "n1"
      )
    ).toBeNull();
    expect(email.queue).not.toHaveBeenCalled();
  });

  it("is not queued where the site sends no email, the notice is gone, or its person has no address", async () => {
    const cases = [
      { email: sender(false), db: holding(NOTICE, "owner@example.com") },
      { email: sender(), db: holding(null, "owner@example.com") },
      { email: sender(), db: holding(NOTICE, null) },
      {
        email: sender(),
        db: holding({ ...NOTICE, kind: "workflows.assigned" }, "o@x.example"),
      },
    ];
    for (const { email, db } of cases) {
      expect(await emailReleaseNotice({ db, email }, "n1")).toBeNull();
      expect(email.queue).not.toHaveBeenCalled();
    }
    expect(
      await emailReleaseNotice(
        { db: holding(NOTICE, "o@x.example"), email: null },
        "n1"
      )
    ).toBeNull();
  });
});

describe("the overdue notice's text", () => {
  it("says a release missed its time while it has not run, and that it ran late once it has", () => {
    const missed = RELEASE_OVERDUE_NOTICE.render(NOTICE.data, {
      subjectGone: false,
    });
    expect(missed.title).toBe("“Spring launch” missed its time");
    expect(missed.body).toContain("10 minutes past its time and had not run");

    const late = RELEASE_OVERDUE_NOTICE.render(
      { ...NOTICE.data, ranAt: "2026-10-29T11:00:00.000Z" },
      { subjectGone: false }
    );
    expect(late.title).toBe("“Spring launch” ran late");
    expect(late.body).toContain("ran more than 10 minutes after its time");
  });
});
