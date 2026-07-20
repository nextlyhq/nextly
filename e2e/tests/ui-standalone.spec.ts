/**
 * `@nextlyhq/ui` outside the admin.
 *
 * The package ships two compiled stylesheets and, until now, nothing exercised
 * either of them away from `.nextly-admin`:
 *
 *   - `styles.css` styles the whole document, which is what a greenfield app
 *     wants and what makes it unsafe to drop into an existing one — Tailwind's
 *     preflight resets `html`/`body`/`*`.
 *   - `styles.scoped.css` confines every rule to `.nextly-ui`, so components
 *     still get the preflight they are designed against while the rest of the
 *     host page keeps its own styles.
 *
 * These assert both halves of that contract in a real browser: the components
 * paint, and the scoped sheet leaves the surrounding document alone.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/ui/dist"
);

/**
 * Read on demand rather than at module load: an unbuilt `packages/ui/dist`
 * would otherwise throw during collection, and the runner reports a module
 * load failure with a bare ENOENT instead of naming the test and the fix.
 */
function sheet(name: string): string {
  try {
    return readFileSync(resolve(DIST, name), "utf8");
  } catch {
    throw new Error(
      `${name} is missing from ${DIST}. Build the UI package first: pnpm build`
    );
  }
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** A host page that already has its own content and styling expectations. */
const HOST_MARKUP = `
  <h1 id="host-heading">Host heading</h1>
  <div class="nextly-ui">
    <div id="kit-surface" class="bg-primary">Kit surface</div>
  </div>
`;

test("the precompiled sheet styles components on a bare page", async ({
  page,
}) => {
  await page.setContent(`<div id="kit-surface" class="bg-primary">x</div>`);
  await page.addStyleTag({ content: sheet("styles.css") });

  const background = await page.$eval(
    "#kit-surface",
    el => getComputedStyle(el).backgroundColor
  );

  expect(background).not.toBe(TRANSPARENT);
});

test("the scoped sheet styles components inside the wrapper", async ({
  page,
}) => {
  await page.setContent(HOST_MARKUP);
  await page.addStyleTag({ content: sheet("styles.scoped.css") });

  const background = await page.$eval(
    "#kit-surface",
    el => getComputedStyle(el).backgroundColor
  );

  // The token has to resolve too: `bg-primary` reads `--nx-primary`, which the
  // scoped sheet declares on `.nextly-ui` rather than `:root`.
  expect(background).not.toBe(TRANSPARENT);
});

test("the scoped sheet does not hijack the host's animation names", async ({
  page,
}) => {
  // Animation names resolve globally, so selector scoping alone does not
  // isolate them. The host defines `spin` — a name the kit also uses — and its
  // definition must survive the scoped sheet being added afterwards, which is
  // the source order that would let a colliding definition win.
  await page.setContent(`
    <style>
      @keyframes spin { from, to { opacity: 0.5 } }
      #host-spinner { animation: spin 10s infinite }
    </style>
    <div id="host-spinner">Host spinner</div>
  `);
  await page.addStyleTag({ content: sheet("styles.scoped.css") });

  // The kit's own `spin` animates transform and never touches opacity, so if it
  // had displaced the host's definition this would read back as "1".
  const opacity = await page.$eval(
    "#host-spinner",
    el => getComputedStyle(el).opacity
  );

  expect(opacity).toBe("0.5");
});

test("the scoped sheet leaves the host document alone", async ({ page }) => {
  // Baseline: what the browser gives an <h1> with no stylesheet at all.
  await page.setContent(HOST_MARKUP);
  const untouched = await page.$eval(
    "#host-heading",
    el => getComputedStyle(el).marginTop
  );

  await page.setContent(HOST_MARKUP);
  await page.addStyleTag({ content: sheet("styles.scoped.css") });
  const withScoped = await page.$eval(
    "#host-heading",
    el => getComputedStyle(el).marginTop
  );

  expect(withScoped).toBe(untouched);

  // And prove the assertion is meaningful: the unscoped sheet does reset it,
  // which is exactly why the scoped variant exists.
  await page.setContent(HOST_MARKUP);
  await page.addStyleTag({ content: sheet("styles.css") });
  const withUnscoped = await page.$eval(
    "#host-heading",
    el => getComputedStyle(el).marginTop
  );

  expect(withUnscoped).not.toBe(untouched);
});
