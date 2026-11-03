/**
 * Exporting a component with its image from the Components list, and
 * importing files back through the preview above the list, as an author does.
 *
 * Each case seeds what it needs through the admin API and works from the list
 * screen. What the export wrote is read from the downloaded file; what the
 * import stored is read back through the API.
 *
 * @module tests/builder-transfer.spec
 */
import { readFile } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { test } from "./support/test";

const COMPONENTS = "/admin/api/collections/components/entries";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

interface ExportedFile {
  format: string;
  root: { kind: string; id: string };
  components: {
    id: string;
    title: string;
    content: { nodes: { props: Record<string, unknown> }[] };
  }[];
  media: { id: string; filename: string; data: string }[];
}

async function created(
  page: Page,
  url: string,
  data: Record<string, unknown>
): Promise<string> {
  const answer = await page.request.post(url, { data });
  expect(
    answer.ok(),
    `seeding ${url}: ${answer.status()} ${await answer.text()}`
  ).toBe(true);
  return ((await answer.json()) as { item: { id: string } }).item.id;
}

/** A published component showing an uploaded image. */
async function seedComponent(
  page: Page,
  tag: string
): Promise<{ id: string; title: string; mediaId: string }> {
  const uploaded = await page.request.post("/admin/api/media", {
    multipart: {
      file: { name: `transfer-${tag}.png`, mimeType: "image/png", buffer: PNG },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as {
    item?: { id: string };
    id?: string;
  };
  const mediaId = String(body.item?.id ?? body.id);
  const title = `Transfer card ${tag}`;
  const id = await created(page, COMPONENTS, {
    title,
    slug: `transfer-card-${tag}`,
    status: "published",
    content: {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: title, level: "h2" },
        },
        {
          id: "i",
          type: "core/image",
          version: 1,
          props: { mediaId, alt: "A dot" },
        },
      ],
    },
  });
  return { id, title, mediaId };
}

/** The file input "Import from file" opens, given a file to read. */
async function importFile(
  page: Page,
  name: string,
  contents: string
): Promise<void> {
  await expect(
    page.getByRole("button", { name: "Import from file" })
  ).toBeVisible();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(contents),
  });
}

/** A hand-made file holding one component whose only block is `node`. */
function fileWith(
  tag: string,
  node: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    format: "nextly-page-builder-transfer",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    root: { kind: "component", id: "c" },
    components: [
      {
        id: "c",
        title: `Handmade ${tag}`,
        slug: `handmade-${tag}`,
        status: "published",
        content: { formatVersion: 1, kind: "component", nodes: [node] },
      },
    ],
    patterns: [],
    layouts: [],
    classes: [],
    tokens: [],
    breakpoints: [],
    media: [],
    blockTypes: [],
    ...extra,
  });
}

/**
 * The file with a 100 KB description on its component, so the import's
 * request is larger than any small-body limit a route could be held to.
 */
function withLongDescription(contents: string): string {
  const file = JSON.parse(contents) as {
    components: { description?: string }[];
  };
  const [first] = file.components;
  if (first !== undefined) first.description = "x".repeat(100_000);
  return JSON.stringify(file);
}

test.describe("moving items between sites as files", () => {
  test("exports a component with its image, then imports it back as a renamed copy reusing the image", async ({
    page,
  }, testInfo) => {
    const tag = Date.now().toString(36);
    const seeded = await seedComponent(page, tag);
    await gotoAdmin(page, "/collections/components");

    // Export from the row's own actions.
    // A clickable row is drawn as a button, so it is found by the link it holds.
    const row = page.locator("tr", {
      has: page.getByRole("link", { name: seeded.title }),
    });
    await row.getByRole("button", { name: "Row actions" }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(
      `transfer-card-${tag}.component.nextly.json`
    );
    const path = testInfo.outputPath("export.json");
    await download.saveAs(path);
    const text = await readFile(path, "utf8");
    const file = JSON.parse(text) as ExportedFile;
    expect(file.format).toBe("nextly-page-builder-transfer");
    expect(file.root).toEqual({ kind: "component", id: seeded.id });
    expect(file.media.map(entry => entry.id)).toEqual([seeded.mediaId]);
    expect(Buffer.from(file.media[0]?.data ?? "", "base64").equals(PNG)).toBe(
      true
    );
    await expect(page.getByText("Exported, with 1 media file.")).toBeVisible();

    // Import the same file into the same site: the component clashes by
    // name and is added as a copy; the identical image is reused.
    await importFile(page, "export.json", text);
    const dialog = page.getByRole("dialog", {
      name: `Import "${seeded.title}"`,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Same name as something on this site")
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: `Add as "${seeded.title} (2)"` })
    ).toBeChecked();
    await expect(
      dialog.getByText("Already on this site, used as they are")
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Import" }).click();

    await expect(page).toHaveURL(/\/admin\/collections\/components\/[^/]+/);
    const copyId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? ""
    );
    expect(copyId).not.toBe(seeded.id);
    const stored = await page.request.get(`${COMPONENTS}/${copyId}`);
    expect(stored.ok()).toBe(true);
    const copy = (await stored.json()) as {
      item?: {
        title: string;
        content: { nodes: { props: Record<string, unknown> }[] };
      };
      title?: string;
      content?: { nodes: { props: Record<string, unknown> }[] };
    };
    const item =
      copy.item ??
      (copy as {
        title: string;
        content: { nodes: { props: Record<string, unknown> }[] };
      });
    expect(item.title).toBe(`${seeded.title} (2)`);
    expect(item.content.nodes[1]?.props.mediaId).toBe(seeded.mediaId);
  });

  test("lists a block the site lacks and cannot be confirmed", async ({
    page,
  }) => {
    const tag = Date.now().toString(36);
    await gotoAdmin(page, "/collections/components");

    await importFile(
      page,
      "missing.json",
      fileWith(tag, {
        id: "x",
        type: "acme/not-installed",
        version: 1,
        props: {},
      })
    );

    const dialog = page.getByRole("dialog", {
      name: `Import "Handmade ${tag}"`,
    });
    await expect(
      dialog.getByText("This site is missing blocks the file uses")
    ).toBeVisible();
    await expect(dialog.getByText("acme/not-installed")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Import from file" })
    ).toBeFocused();
  });

  test("waits for a choice on a breakpoint the site lacks, then imports without its styles", async ({
    page,
  }) => {
    const tag = Date.now().toString(36);
    await gotoAdmin(page, "/collections/components");
    const node = {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: `Styled ${tag}`, level: "h2" },
      styles: {
        base: { base: { color: "#111111" }, odd: { color: "#222222" } },
      },
    };

    await importFile(
      page,
      "breakpoint.json",
      withLongDescription(
        fileWith(tag, node, {
          breakpoints: [
            { id: "odd", label: "Odd", axis: "viewport", maxWidth: 333 },
          ],
        })
      )
    );

    const dialog = page.getByRole("dialog", {
      name: `Import "Handmade ${tag}"`,
    });
    await expect(
      dialog.getByText("Breakpoints this site does not have")
    ).toBeVisible();
    await expect(dialog.getByText("Odd (333px)")).toBeVisible();
    await expect(dialog.getByText("Used by 1 style")).toBeVisible();
    const importButton = dialog.getByRole("button", { name: "Import" });
    await expect(importButton).toBeDisabled();

    await dialog
      .getByRole("radio", { name: "Drop its styles and hide settings" })
      .check();
    await expect(importButton).toBeEnabled();
    await importButton.click();

    await expect(page).toHaveURL(/\/admin\/collections\/components\/[^/]+/);
    const id = decodeURIComponent(
      new URL(page.url()).pathname.split("/").filter(Boolean).at(-1) ?? ""
    );
    const stored = await page.request.get(`${COMPONENTS}/${id}`);
    const body = (await stored.json()) as {
      item?: { content: { nodes: { styles?: unknown }[] } };
      content?: { nodes: { styles?: unknown }[] };
    };
    const content = body.item?.content ?? body.content;
    expect(content?.nodes[0]?.styles).toEqual({
      base: { base: { color: "#111111" } },
    });
  });
});
