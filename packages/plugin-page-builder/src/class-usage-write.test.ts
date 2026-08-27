/**
 * Whether a save reconciles every subject its document owns, and whether it can
 * fail the save while doing it.
 *
 * Both directions cost something specific. A subject skipped keeps rows that
 * disagree with the document, and the classes only that subject applies read as
 * unused — which is the state that licences deleting a class a page renders. A
 * failure raised instead of reported tells the author their save failed for a
 * document that is already committed to disk.
 *
 * @module class-usage-write.test
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { ClassUsageIndexStore } from "./class-usage-maintenance";
import type { ClassUsageSubject } from "./class-usage-reconcile";
import { reconcileWrittenDocument } from "./class-usage-write";

/** A document whose single node applies the given classes. */
const documentUsing = (...classes: string[]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

/** A store holding no rows, recording every write it is asked to make. */
function recordingStore() {
  const calls: string[] = [];
  const store: ClassUsageIndexStore = {
    find: async () => ({ items: [], meta: { hasNext: false } }),
    create: async args => {
      calls.push(`create:${String(args.data.classId)}`);
      return {};
    },
    delete: async args => {
      calls.push(`delete:${args.id}`);
      return {};
    },
  };
  return { store, calls };
}

/** How a subject is named in an assertion, so a miss reads as a locale/variant. */
const addressOf = (s: ClassUsageSubject) =>
  `${s.field}/${s.locale || "-"}/${s.variant}`;

describe("a collection this index does not track", () => {
  it("reconciles nothing and does not read a single document", async () => {
    // The hook fires for EVERY collection, so this is the common path. The
    // reader is the expensive part — one read per subject — and a filter that
    // ran after reading would cost every save on the site.
    const { store, calls } = recordingStore();
    let reads = 0;

    const report = await reconcileWrittenDocument({
      store,
      read: async () => {
        reads += 1;
        return documentUsing("hero");
      },
      collection: {
        slug: "posts",
        fields: [{ type: "text", name: "title" }],
        hasDrafts: true,
      },
      documentId: "p1",
      locales: ["en", "fr"],
      limits: DEFAULT_LIMITS,
    });

    expect(report.subjects).toBe(0);
    expect(reads).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("enumerating the subjects one save owes", () => {
  it("visits every locale and variant, not only the one that changed", async () => {
    // The hook is not told which locale or variant was written: `_status` is
    // stripped from the payload and the write locale is never forwarded. So
    // every subject the document owns is re-derived, or the ones that were not
    // written keep rows that disagree with it.
    const { store } = recordingStore();
    const seen: string[] = [];

    const report = await reconcileWrittenDocument({
      store,
      read: async subject => {
        seen.push(addressOf(subject));
        return documentUsing("hero");
      },
      collection: {
        slug: "pages",
        localized: true,
        fields: [{ type: "blocks", name: "content", localized: true }],
        hasDrafts: true,
      },
      documentId: "p1",
      locales: ["en", "fr"],
      limits: DEFAULT_LIMITS,
    });

    expect(seen).toEqual([
      "content/en/published",
      "content/en/draft",
      "content/fr/published",
      "content/fr/draft",
    ]);
    expect(report).toMatchObject({ subjects: 4, reconciled: 4, absent: 0 });
    expect(report.failures).toEqual([]);
  });

  it("visits only the published variant when the collection keeps no draft", async () => {
    // The control on the case above. Without it, a walk that always enumerated
    // both variants would satisfy that assertion just as well — and would file
    // rows against a draft document that cannot exist, which nothing
    // downstream can tell from a real one.
    const { store } = recordingStore();
    const seen: string[] = [];

    await reconcileWrittenDocument({
      store,
      read: async subject => {
        seen.push(addressOf(subject));
        return documentUsing("hero");
      },
      collection: {
        slug: "pages",
        fields: [{ type: "blocks", name: "content" }],
        hasDrafts: false,
      },
      documentId: "p1",
      locales: ["en", "fr"],
      limits: DEFAULT_LIMITS,
    });

    expect(seen).toEqual(["content/-/published"]);
  });
});

describe("a document that is not there in one locale or variant", () => {
  it("leaves that subject's rows ALONE rather than reconciling against nothing", async () => {
    // Absence is ordinary: a collection with drafts holds a published row for a
    // document with no pending draft. Reconciling against nothing would delete
    // that subject's rows, and the rebuild's sweep — which can tell a deleted
    // document from an untranslated one — is what removes rows that are really
    // orphaned.
    const { store, calls } = recordingStore();

    const report = await reconcileWrittenDocument({
      store,
      read: async subject =>
        subject.variant === "draft" ? null : documentUsing("hero"),
      collection: {
        slug: "pages",
        fields: [{ type: "blocks", name: "content" }],
        hasDrafts: true,
      },
      documentId: "p1",
      locales: [],
      limits: DEFAULT_LIMITS,
    });

    expect(report).toMatchObject({ subjects: 2, reconciled: 1, absent: 1 });
    // One create for the published document, and NOTHING for the absent draft.
    expect(calls).toEqual(["create:hero"]);
  });
});

describe("a subject that fails", () => {
  it("is reported rather than thrown, because the write already committed", async () => {
    // `after*` hooks run after the write commits. A throw here reports a failed
    // save for a document that is on disk, so the author is told their work was
    // lost when it was not.
    const { store } = recordingStore();

    const report = await reconcileWrittenDocument({
      store,
      read: async () => {
        throw new Error("connection lost");
      },
      collection: {
        slug: "pages",
        fields: [{ type: "blocks", name: "content" }],
        hasDrafts: false,
      },
      documentId: "p1",
      locales: [],
      limits: DEFAULT_LIMITS,
    });

    expect(report.failures).toHaveLength(1);
    expect((report.failures[0]?.failure as Error).message).toBe(
      "connection lost"
    );
    expect(report.reconciled).toBe(0);
  });

  it("does not stop the subjects after it", async () => {
    // Each subject's rows are independent. Stopping would leave every later
    // subject stale as well as the failed one, turning one recoverable
    // disagreement into several — and reconciliation is idempotent, so a rerun
    // repairs whatever this pass could not.
    const { store, calls } = recordingStore();

    const report = await reconcileWrittenDocument({
      store,
      read: async subject => {
        if (subject.locale === "en") throw new Error("connection lost");
        return documentUsing("hero");
      },
      collection: {
        slug: "pages",
        localized: true,
        fields: [{ type: "blocks", name: "content", localized: true }],
        hasDrafts: false,
      },
      documentId: "p1",
      locales: ["en", "fr", "de"],
      limits: DEFAULT_LIMITS,
    });

    expect(report).toMatchObject({ subjects: 3, reconciled: 2 });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.subject.locale).toBe("en");
    // The two locales after the failure were still written.
    expect(calls).toEqual(["create:hero", "create:hero"]);
  });

  it("reports a reconciliation failure the same way as a read failure", async () => {
    // Both leave the subject holding whatever it held, and after the write has
    // committed a caller cannot respond to them differently.
    const store: ClassUsageIndexStore = {
      find: async () => {
        throw new Error("index unavailable");
      },
      create: async () => ({}),
      delete: async () => ({}),
    };

    const report = await reconcileWrittenDocument({
      store,
      read: async () => documentUsing("hero"),
      collection: {
        slug: "pages",
        fields: [{ type: "blocks", name: "content" }],
        hasDrafts: false,
      },
      documentId: "p1",
      locales: [],
      limits: DEFAULT_LIMITS,
    });

    expect(report.failures).toHaveLength(1);
    expect((report.failures[0]?.failure as Error).message).toBe(
      "index unavailable"
    );
  });
});
