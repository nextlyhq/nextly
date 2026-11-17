/**
 * A routed page's forms: the route fills `ctx.forms` from the page builder's
 * `site-forms` service on each render, naming the stored document the page
 * draws and the path a visitor comes back to, and leaves it out where the
 * instance offers no such service.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import type { PageForms } from "./context";
import { createBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { createBlockResolver, SITE_FORMS_SERVICE } from "./resolver";

let offered: Record<string, Record<string, unknown>> = {};

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("nextly/runtime")>()),
  requireNextly: () => ({ plugins: offered }),
}));

afterEach(() => {
  offered = {};
});

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [{ id: "f", type: "core/form", version: 2, props: {} }],
};

const reader = {
  find: vi.fn(async () => ({
    items: [{ id: "p1", slug: "contact", content: document }],
    meta: {},
  })),
  findByID: vi.fn(async () => null),
  media: { findByID: vi.fn(async () => null) },
};

/** The forms the route handed the page it drew. */
async function formsOfPage(): Promise<PageForms | undefined> {
  const route = createBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: reader as never,
    blocks: createBlockResolver(coreBlocks as never),
  });
  const element = (await throughBoundary(
    route.ContentPage({ params: { slug: ["contact"] } })
  )) as ReactElement<PageRendererProps>;
  return element.props.context?.forms;
}

/** The page builder's service, recording what it was asked. */
function offerForms() {
  const rows: unknown[] = [];
  offered = {
    [SITE_FORMS_SERVICE.plugin]: {
      [SITE_FORMS_SERVICE.service]: {
        action: "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send",
        documentOf: (row: unknown) => {
          rows.push(row);
          return "page:p1";
        },
        componentDocument: (id: string) => `component:${id}`,
        describe: async () => ({ unavailable: "missing" }),
      },
    },
  };
  return { rows };
}

describe("a routed page's forms", () => {
  it("post to the page builder's receiver, naming the page and its path", async () => {
    const { rows } = offerForms();
    const forms = await formsOfPage();
    expect(forms?.action).toBe(
      "/admin/api/plugins/@nextlyhq/plugin-page-builder/forms/send"
    );
    expect(forms?.document).toBe("page:p1");
    expect(forms?.returnTo).toBe("/contact");
    // Asked about the row the page was read from and the field it draws.
    expect(rows).toEqual([{ collection: "pages", id: "p1", field: "content" }]);
  });

  it("are left out where the instance has no page builder to post to", async () => {
    expect(await formsOfPage()).toBeUndefined();
  });

  it("are left out where what is offered is not the service", async () => {
    offered = {
      [SITE_FORMS_SERVICE.plugin]: {
        [SITE_FORMS_SERVICE.service]: { action: 42 },
      },
    };
    expect(await formsOfPage()).toBeUndefined();
  });
});

describe("a form in a header or footer", () => {
  it("posts naming the region's component, not the page around it", async () => {
    const { drawWithRegions } = await import("./page-read-stages");
    const pageForms: PageForms = {
      action: "/send",
      document: "page:p1",
      returnTo: "/contact",
      describe: async () => ({ unavailable: "missing" }),
    };
    const drawn = drawWithRegions({
      regions: [
        {
          region: { area: "footer", componentId: "c9" },
          document,
          prepared: null,
        },
      ],
      page: { document, context: { forms: pageForms } } as never,
      shared: { context: { forms: pageForms } } as never,
      siteStyles: undefined,
      definitions: new Map(),
      formsFor: id => ({ ...pageForms, document: `component:${id}` }),
    }) as ReactElement<{ children?: ReactElement<PageRendererProps> }>[];
    const footer = drawn.find(element => element.type === "footer");
    expect(footer?.props.children?.props.context?.forms?.document).toBe(
      "component:c9"
    );
    // The page itself keeps its own.
    const page = drawn.find(element => element.key === "page") as
      | ReactElement<PageRendererProps>
      | undefined;
    expect(page?.props.context?.forms?.document).toBe("page:p1");
  });
});
