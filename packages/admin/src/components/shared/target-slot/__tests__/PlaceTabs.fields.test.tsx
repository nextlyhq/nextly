/**
 * A contributed tab that edits fields of the document (`fields`): drawn only
 * on an edit page whose document has every one of them, so a tab made for a
 * group the plugin adds never opens on a document without it, and never on a
 * page that has no document to judge.
 */
import { render, screen } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

import { PlaceTabs } from "..";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

const TAB = "@acme/a/admin#SeoTab";
registerComponent(TAB, (() => <p>seo tab body</p>) as never);

afterEach(() => {
  meta.contributions = undefined;
});

function deliver(fields: string[] | undefined): void {
  meta.contributions = {
    "collection.edit": {
      tab: [
        {
          plugin: "@acme/a",
          id: "acme-a.seo",
          kind: "tab",
          label: "SEO",
          component: TAB,
          ...(fields === undefined ? {} : { fields }),
        },
      ],
    },
  } as AdminContributionsMeta;
}

function page(fieldNames?: readonly string[]) {
  return render(
    <PlaceTabs
      place="collection.edit"
      context={{ userId: "u1", collection: "posts", entryId: "e1" }}
      contentLabel="Content"
      {...(fieldNames === undefined ? {} : { fieldNames })}
    >
      <p>content</p>
    </PlaceTabs>
  );
}

describe("a tab that edits fields of the document", () => {
  it("is drawn on a document that has every field it names", () => {
    deliver(["seo", "summary"]);
    page(["title", "seo", "summary"]);
    expect(screen.getByRole("tab", { name: "SEO" })).toBeInTheDocument();
  });

  it("is not drawn on a document missing one of them", () => {
    deliver(["seo", "summary"]);
    page(["title", "seo"]);
    expect(screen.queryByRole("tab", { name: "SEO" })).toBeNull();
    // With no tab left the page's content is drawn as it is, with no strip.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("content")).toBeVisible();
  });

  it("is not drawn where the page names no document fields", () => {
    deliver(["seo"]);
    page();
    expect(screen.queryByRole("tab", { name: "SEO" })).toBeNull();
  });

  it("leaves a tab that names no fields to the place's other rules", () => {
    deliver(undefined);
    page(["title"]);
    expect(screen.getByRole("tab", { name: "SEO" })).toBeInTheDocument();
  });
});
