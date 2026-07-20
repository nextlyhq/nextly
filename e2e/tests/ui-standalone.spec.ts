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

test("a host dark mode does not flip the kit's dark utilities", async ({
  page,
}) => {
  // `dark:` compiles to `:where(.dark, .dark *)`, which a host `<html class="dark">`
  // satisfies for everything on the page. The dark tokens, though, are declared
  // on `.nextly-ui.dark`. So an unconfined variant flips the utilities while the
  // tokens stay light, painting dark-mode rules with light-mode values.
  const markup = (hostClass: string, wrapperClass: string) => `
    <div class="${hostClass}">
      <div class="${wrapperClass}">
        <div id="swatch" class="dark:bg-primary/20">swatch</div>
      </div>
    </div>
  `;

  const read = async (hostClass: string, wrapperClass: string) => {
    await page.setContent(markup(hostClass, wrapperClass));
    await page.addStyleTag({ content: sheet("styles.scoped.css") });
    return page.$eval("#swatch", el => getComputedStyle(el).backgroundColor);
  };

  const neutral = await read("", "nextly-ui");
  const hostDark = await read("dark", "nextly-ui");
  const wrapperDark = await read("", "nextly-ui dark");

  // The host's dark class must not reach inside the wrapper.
  expect(hostDark).toBe(neutral);
  // And the wrapper's own dark class still must, or the variant is simply dead.
  expect(wrapperDark).not.toBe(neutral);
});

test("the scoped sheet keeps @property-backed utilities working", async ({
  page,
}) => {
  // Tailwind's `--tw-*` registrations are document-global, so the scoped sheet
  // namespaces them rather than redefining names the host may use itself.
  // Renaming a registration without renaming every reference would leave the
  // utility composing against an unregistered property, so assert one that
  // actually composes through them still resolves.
  await page.setContent(`
    <div class="nextly-ui">
      <div id="shifted" class="-translate-y-1/2">shifted</div>
    </div>
  `);
  await page.addStyleTag({ content: sheet("styles.scoped.css") });

  // The utility sets `translate: var(--nx-tw-translate-x) var(--nx-tw-translate-y)`.
  // Both halves have to resolve for the shorthand to be valid, and the x half
  // comes only from its @property initial value — so this is dead unless the
  // registration and the reference were renamed together.
  const translate = await page.$eval(
    "#shifted",
    el => getComputedStyle(el).translate
  );

  expect(translate).not.toBe("none");
  expect(translate).toContain("-50%");
});

test("the scoped sheet leaves the host's --tw-* properties alone", async ({
  page,
}) => {
  // A Tailwind v3 host uses `--tw-*` as ordinary inherited custom properties.
  // Registering them via @property would make them non-inheriting with an
  // initial value, changing the host's rendering without any selector leaking.
  await page.setContent(`
    <div id="outer" style="--tw-translate-x: 42px">
      <div id="inner">inner</div>
    </div>
  `);
  await page.addStyleTag({ content: sheet("styles.scoped.css") });

  const inherited = await page.$eval("#inner", el =>
    getComputedStyle(el).getPropertyValue("--tw-translate-x").trim()
  );

  expect(inherited).toBe("42px");
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
