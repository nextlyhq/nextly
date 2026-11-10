/**
 * The Icon block, end to end: a published page draws it with no script, the
 * canvas draws it, and the Content tab changes it through the picker, which
 * offers the author's recent icons first.
 *
 * - Published, the SVG is in the server's HTML, so the block ships no script;
 *   a decorative icon is hidden from assistive technology, a labelled one is
 *   an image with that name, and a linked one a link named by its label.
 * - On the canvas the icon is drawn from the same set, loaded when first
 *   needed.
 * - Choosing another icon in the picker redraws the canvas and is stored as
 *   the block's id; the next time the picker opens, it is first under Recent.
 *
 * @module tests/builder-icon.spec
 */
import { expect, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { canvasBlock, canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const PAGES = "/admin/api/collections/pages/entries";

/**
 * The client components a served page references, read from the payload the
 * server sent (`self.__next_f`), as `<module>#<export>`. A block that ran in
 * the browser would add one; a block drawn only on the server adds none.
 */
async function clientReferencesOf(page: Page, path: string): Promise<string[]> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  return page.evaluate(() => {
    // The payload as the server sent it, from the inline scripts that pushed
    // it: hydration empties `self.__next_f` itself.
    const pushed = Array.from(document.scripts, script => {
      const text = script.textContent ?? "";
      const start = text.indexOf("self.__next_f.push(");
      if (start === -1) return "";
      const entry = JSON.parse(
        text.slice(start + "self.__next_f.push(".length, text.lastIndexOf(")"))
      ) as unknown[];
      return typeof entry[1] === "string" ? entry[1] : "";
    }).join("");
    // Under `next dev` a client reference names its module and export as
    // `$<row>`, a reference to another row of this payload that holds the
    // string. The row's number differs per response; what it holds, the
    // module's path, does not. A production build writes both in place.
    const strings = new Map(
      [
        ...pushed.matchAll(
          /(?:^|\n)([0-9a-f]+):("(?:[^"\\\n]|\\.)*")(?=\n|$)/g
        ),
      ].map(row => [String(row[1]), JSON.parse(String(row[2])) as string])
    );
    const followed = (value: unknown): string => {
      const text = String(value);
      if (!text.startsWith("$")) return text;
      const row = strings.get(text.slice(1));
      // An unresolved reference is a payload this read no longer understands,
      // and reading it as anything would let two modules compare equal.
      if (row === undefined) throw new Error(`no payload row for ${text}`);
      return row;
    };
    // A client reference row is `<row>:I[<module>,[<chunks>],"<export>"]`.
    return [
      ...new Set(
        [...pushed.matchAll(/(?:^|\n)[0-9a-f]+:I(\[[^\n]*\])/g)].map(match => {
          const [module, , name] = JSON.parse(match[1] ?? "[]") as unknown[];
          return `${followed(module)}#${followed(name)}`;
        })
      ),
    ].sort();
  });
}

/** A page with a decorative icon, a labelled one and a linked one. */
async function seed(
  page: Page,
  status: "draft" | "published",
  withIcons = true
): Promise<{ id: string; slug: string }> {
  const run = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const slug = `icons-${run}`;
  const created = await page.request.post(PAGES, {
    data: {
      title: "Icons",
      slug,
      status,
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "lead",
            type: "core/heading",
            version: 1,
            props: { text: "Why shop with us", level: "h2" },
          },
          ...(withIcons ? ICONS : []),
        ],
      },
    },
  });
  expect(created.ok(), `seeding the page: ${created.status()}`).toBe(true);
  const id = ((await created.json()) as { item: { id: string } }).item.id;
  return { id, slug };
}

/** The three ways an icon is used: decorative, labelled and linked. */
const ICONS = [
  {
    id: "plain",
    type: "core/icon",
    version: 1,
    props: { icon: "lucide:star", label: "" },
  },
  {
    id: "named",
    type: "core/icon",
    version: 1,
    props: { icon: "lucide:truck", label: "Free delivery" },
  },
  {
    id: "linked",
    type: "core/icon",
    version: 1,
    props: {
      icon: "lucide:mail",
      label: "Write to us",
      href: "/contact",
    },
  },
];

test.describe("the Icon block", () => {
  test.describe.configure({ timeout: 180_000 });

  test("is drawn on a published page from the server's markup", async ({
    page,
  }) => {
    const { slug } = await seed(page, "published");
    const response = await page.goto(`/${slug}`);
    expect(response?.status()).toBe(200);
    // The SVG comes in the server's HTML, the set's own shapes inside it: the
    // block runs no script in the browser to draw it.
    const html = (await response?.text()) ?? "";
    const svgs = [...html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map(
      match => match[0]
    );
    const labelled = svgs.find(svg =>
      svg.includes('aria-label="Free delivery"')
    );
    expect(labelled, "the labelled icon in the HTML").toBeDefined();
    expect(labelled).toContain('role="img"');
    expect(labelled).toMatch(/<(path|circle|rect|line|polyline)\b/);
    // Decorative, the star is drawn and hidden from assistive technology.
    expect(
      svgs.filter(
        svg =>
          svg.includes('aria-hidden="true"') &&
          /<(path|circle|rect)\b/.test(svg)
      ).length
    ).toBeGreaterThanOrEqual(2);

    // And no client component for it: the page's client references are the
    // same as those of the same page without its icons.
    const { slug: plain } = await seed(page, "published", false);
    const withIcons = await clientReferencesOf(page, `/${slug}`);
    // The control: the read finds the page's references at all (every page
    // has its router's), so an equal pair is not two empty readings.
    expect(withIcons.length).toBeGreaterThan(0);
    // The router's own modules share an export name, so reading each by its
    // module leaves more references than names. A read that lost which module
    // a reference names would fold them into one.
    const names = withIcons.map(reference =>
      reference.slice(reference.lastIndexOf("#"))
    );
    expect(new Set(names).size).toBeLessThan(names.length);
    expect(withIcons).toEqual(await clientReferencesOf(page, `/${plain}`));
    await page.goto(`/${slug}`);

    // As the page reads to a visitor: an image with its name, and a link
    // named by its label whose icon is not read a second time.
    const named = page.getByRole("img", { name: "Free delivery" });
    await expect(named).toBeVisible();
    await expect(named).toHaveAttribute("width", "1em");
    await expect(named).toHaveAttribute("stroke", "currentColor");
    const link = page.getByRole("link", { name: "Write to us" });
    await expect(link).toHaveAttribute("href", "/contact");
    await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
  });

  test("is drawn on the canvas, and changed from the Content tab's picker", async ({
    page,
  }) => {
    const { id } = await seed(page, "draft");
    await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
    await expect(canvasBlock(page, "lead")).toBeVisible({ timeout: 30_000 });

    // Drawn on the canvas from the same set as the published page.
    const named = canvasFrame(page).getByRole("img", { name: "Free delivery" });
    await expect(named).toBeVisible({ timeout: 30_000 });
    await expect(named.locator("path, circle, rect").first()).toBeAttached();

    await canvasBlock(page, "named").click();
    await page.getByRole("tab", { name: "Content" }).click();
    const content = page.getByRole("tabpanel", { name: "Content" });
    const field = content.getByRole("button", { name: "Icon: Truck" });
    await expect(field).toBeVisible();

    // Search, choose, and the canvas draws the new icon in the old one's place.
    const drawn = (): Promise<string> =>
      canvasBlock(page, "named").evaluate(
        element =>
          (element.matches("svg") ? element : element.querySelector("svg"))
            ?.innerHTML ?? ""
      );
    const truck = await drawn();
    expect(truck).not.toBe("");
    await field.click();
    const search = page.getByRole("combobox", { name: "Search icons" });
    await expect(search).toBeFocused();
    await search.fill("package");
    await page.getByRole("option", { name: "Package", exact: true }).click();
    await expect(
      content.getByRole("button", { name: "Icon: Package" })
    ).toBeVisible();
    await expect.poll(drawn).not.toBe(truck);
    expect(await drawn()).not.toBe("");

    // The next time the picker opens, the icon just chosen leads, under Recent.
    await content.getByRole("button", { name: "Icon: Package" }).click();
    await expect(
      page.getByRole("option", { name: "Package, recent, current" })
    ).toBeVisible();
    await expect(page.getByText("Recent", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      content.getByRole("button", { name: "Icon: Package" })
    ).toBeFocused();
  });
});
