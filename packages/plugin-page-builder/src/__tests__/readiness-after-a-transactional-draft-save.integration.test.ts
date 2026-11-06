/**
 * A component's draft saved through the transactional update is not a publish
 * to the readiness notice.
 *
 * The notice tells an author that a document they just published embeds a
 * component that is not published. A held draft of a live component keeps
 * `status: "published"`, so only `_isWorkingDraft` tells the two apart. The
 * transactional update hands its after-hooks the caller's transaction, and the
 * notice declines there, since a pooled read could not see the write; that is
 * one reason a bulk draft save is not reported as a publish. Observed by the
 * notice actually recorded, with a publish through the single-entry update as
 * the control that the observation reaches the mechanism. The other reason is
 * the notice's own test of the document, which reads the working-draft marker:
 * asked of the context the transactional draft save actually hands its hooks,
 * it answers "not a publish".
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const recorded: Array<{ code?: unknown }> = [];

vi.mock("nextly", async importOriginal => {
  // The real module spread, so every other export stays itself.
  const real = await importOriginal<Record<string, unknown>>();
  const record = real.recordAdvisoryNotice as (notice: unknown) => void;
  return {
    ...real,
    recordAdvisoryNotice: (notice: { code?: unknown }) => {
      recorded.push(notice);
      record(notice);
    },
  };
});

const { COMPONENTS_SLUG } = await import("../collections/components");
const { COMPONENTS_NOT_PUBLISHED_CODE, leavesDocumentPublished } = await import(
  "../component-readiness-hook"
);
const { pageBuilder } = await import("../plugin");

/** The transactional update, narrowed to the call used. */
interface Service {
  updateMany: (
    slug: string,
    entries: Array<{ id: string; data: Record<string, unknown> }>,
    ctx: Record<string, unknown>
  ) => Promise<{ successful: number; failed: number }>;
  getCollection: (
    slug: string,
    ctx: Record<string, unknown>
  ) => Promise<unknown>;
}

const componentOf = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
});

const heading = (id: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const placing = (id: string, componentId: string) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const notices = () =>
  recorded.filter(notice => notice.code === COMPONENTS_NOT_PUBLISHED_CODE);

describe.each(getConfiguredTestDialects())(
  "the readiness notice after a transactional draft save (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let hostId = "";

    beforeAll(async () => {
      t = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      // A component that is not published, embedded in a live one.
      const unpublished = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "teaser",
          slug: "teaser",
          content: componentOf([heading("t1")]),
          status: "draft",
        },
        overrideAccess: true,
      });
      const host = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "band",
          slug: "band",
          content: componentOf([placing("b1", String(unpublished.item.id))]),
          status: "published",
        },
        overrideAccess: true,
      });
      hostId = String(host.item.id);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    beforeEach(() => {
      recorded.length = 0;
    });

    it("records no notice for a draft of a live component saved through updateMany", async () => {
      const service = t.getService("collectionService") as unknown as Service;
      const result = await service.updateMany(
        COMPONENTS_SLUG,
        [{ id: hostId, data: { title: "band, edited", _overwrite: true } }],
        { overrideAccess: true }
      );
      expect(result.successful).toBe(1);
      expect(notices()).toEqual([]);
    });

    it("judges the context a transactional draft save hands its hooks as no publish", async () => {
      const service = t.getService("collectionService") as unknown as Service;
      const seen: unknown[] = [];
      t.hooks.register("afterUpdate", COMPONENTS_SLUG, async context => {
        seen.push(context);
      });
      const result = await service.updateMany(
        COMPONENTS_SLUG,
        [
          {
            id: hostId,
            data: { title: "band, edited again", _overwrite: true },
          },
        ],
        { overrideAccess: true }
      );
      expect(result.successful).toBe(1);
      expect(seen).toHaveLength(1);
      const collection = await service.getCollection(COMPONENTS_SLUG, {});
      expect(leavesDocumentPublished(seen[0] as never, collection)).toBe(false);

      // CONTROL: the same question of a transactional publish answers yes,
      // so the answer above is the marker's, not the collection's.
      seen.length = 0;
      await service.updateMany(
        COMPONENTS_SLUG,
        [{ id: hostId, data: { status: "published", _overwrite: true } }],
        { overrideAccess: true }
      );
      expect(leavesDocumentPublished(seen[0] as never, collection)).toBe(true);
    });

    it("records one when the same component is published through the single-entry update", async () => {
      // CONTROL: the observation reaches the notice, so the empty list above
      // is the notice declining rather than nothing being watched.
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: hostId,
        data: {
          title: "band, published",
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(notices()).toHaveLength(1);
    });
  }
);
