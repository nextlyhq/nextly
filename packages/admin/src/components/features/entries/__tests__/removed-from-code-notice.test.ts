/**
 * The words the admin uses for a collection or Single removed from code: the
 * entity named, the configuration it left, and the one next step its state
 * names — and only that step.
 */
import { describe, expect, it } from "vitest";

import {
  noticeAsText,
  removedFromCodeNotice,
  type RemovedEntity,
} from "../removed-from-code-notice";

const pages: RemovedEntity = {
  kind: "collection",
  label: "Pages",
  slug: "pages",
};
const banner: RemovedEntity = {
  kind: "single",
  label: "Banner",
  slug: "banner",
};

const text = (
  entity: RemovedEntity,
  state: Parameters<typeof removedFromCodeNotice>[1]
) => noticeAsText(removedFromCodeNotice(entity, state));

describe("removedFromCodeNotice", () => {
  it("names the entity and says it is no longer in the configuration", () => {
    expect(text(pages, { state: "not-dropped" })).toContain(
      "“Pages” is no longer in the configuration: nextly.config.ts does not declare the collection “pages”."
    );
    expect(text(banner, { state: "not-dropped" })).toContain(
      "does not declare the Single “banner”. It can be read, but not changed."
    );
  });

  it("names migrate:create then migrate while its tables exist and nothing drops it", () => {
    const said = text(pages, { state: "not-dropped" });
    expect(said).toContain(
      "To retire it, run nextly migrate:create, then nextly migrate."
    );
    expect(said).not.toContain("nextly prune");
  });

  it("names nextly migrate and the file while a written drop is pending", () => {
    const said = text(pages, {
      state: "drop-pending",
      migration: "20261027_drop_pages.sql",
    });
    expect(said).toContain(
      "Run nextly migrate to apply 20261027_drop_pages.sql."
    );
    expect(said).not.toContain("migrate:create");
    expect(said).not.toContain("nextly prune");
  });

  it("says a half-retired one was left part-retired and names prune", () => {
    const said = text(banner, { state: "half-retired" });
    expect(said).toContain("An earlier release left it part-retired");
    expect(said).toContain("Run nextly prune, which lists what remains.");
    expect(said).not.toContain("migrate:create");
    // Its table is gone, so it does not promise a read.
    expect(said).not.toContain("can be read");
  });

  it("names no retirement step it cannot vouch for in any other state", () => {
    const said = text(pages, { state: "other" });
    expect(said).toContain("nextly migrate:status");
    expect(said).not.toContain("migrate:create");
    expect(said).not.toContain("nextly prune");
  });
});
