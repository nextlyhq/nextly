import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearDocumentViews,
  matchDocumentView,
} from "@admin/lib/plugins/document-view-registry";
import {
  clearPluginPages,
  matchPluginPage,
} from "@admin/lib/plugins/plugin-route-registry";
import type { PluginMetadata } from "@admin/types/branding";

import { usePluginPageRegistration } from "../usePluginPageRegistration";

afterEach(() => {
  clearPluginPages();
  clearDocumentViews();
});

describe("usePluginPageRegistration", () => {
  it("registers plugin pages from branding into the route registry", () => {
    renderHook(() =>
      usePluginPageRegistration(
        [
          {
            name: "@acme/p",
            collections: [],
            pages: [
              {
                path: "reports",
                component: "@acme/p/admin#Reports",
                requiredPermission: "read-reports",
              },
            ],
          },
        ] satisfies PluginMetadata[],
        true
      )
    );

    expect(matchPluginPage("/admin/plugins/acme-p/reports")).toMatchObject({
      component: "@acme/p/admin#Reports",
      requiredPermission: "read-reports",
    });
  });

  it("clears stale pages when plugins change", () => {
    const { rerender } = renderHook(
      ({ plugins }: { plugins: PluginMetadata[] }) =>
        usePluginPageRegistration(plugins, plugins !== undefined),
      {
        initialProps: {
          plugins: [
            {
              name: "@acme/p",
              collections: [],
              pages: [{ path: "x", component: "@acme/p/admin#X" }],
            },
          ] satisfies PluginMetadata[],
        },
      }
    );
    expect(matchPluginPage("/admin/plugins/acme-p/x")).toBeDefined();

    rerender({ plugins: [] });
    expect(matchPluginPage("/admin/plugins/acme-p/x")).toBeUndefined();
  });

  it("registers document views", () => {
    renderHook(() =>
      usePluginPageRegistration(
        [
          {
            name: "@acme/pb",
            collections: [],
            documentViews: [
              {
                slug: "pages",
                path: "builder",
                component: "@acme/pb/admin#Builder",
              },
            ],
          },
        ] satisfies PluginMetadata[],
        true
      )
    );

    expect(matchDocumentView("collection", "pages", "builder")).toMatchObject({
      component: "@acme/pb/admin#Builder",
    });
  });

  it("clears a document view whose plugin stops contributing it", () => {
    const initial: PluginMetadata[] = [
      {
        name: "@acme/pb",
        collections: [],
        documentViews: [
          { slug: "pages", path: "builder", component: "@acme/pb/admin#B" },
        ],
      },
    ];
    const { rerender } = renderHook(
      ({ plugins }: { plugins: PluginMetadata[] }) =>
        usePluginPageRegistration(plugins, plugins !== undefined),
      {
        initialProps: { plugins: initial },
      }
    );
    expect(matchDocumentView("collection", "pages", "builder")).toBeDefined();

    rerender({ plugins: [{ name: "@acme/pb", collections: [] }] });
    expect(matchDocumentView("collection", "pages", "builder")).toBeUndefined();
  });
});
