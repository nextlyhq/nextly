import { expect, type Page } from "@playwright/test";

/**
 * The playground's `admin.devAutoLogin` issues a real session for this user on
 * the first `/admin` visit, so the suite never signs in. That is a deliberate
 * limit, not an oversight: it means these tests cannot cover the sign-in page,
 * and the playground cannot render one anyway.
 */
export const ADMIN = "/admin";

export type Theme = "light" | "dark";

/**
 * Open an admin page in a known theme.
 *
 * The theme is written to storage before the app boots rather than clicked
 * through the UI: `next-themes` reads `nextly-theme` on mount, so setting it
 * first means the first paint is already correct and nothing has to wait for a
 * menu. `defaultTheme` is "system", which on a CI machine is whatever the
 * container feels like — a test that did not pin this would assert against a
 * palette it did not choose.
 */
export async function gotoAdmin(
  page: Page,
  path: string,
  theme: Theme = "light"
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["nextly-theme", theme] as const
  );

  await page.goto(`${ADMIN}${path}`);

  // `main`, not the admin root: the root div is server-rendered empty and
  // filled on hydration, so it exists long before there is anything in it —
  // and the app renders two of them, which no strict locator can resolve.
  // `main` appears only once the admin has actually drawn a screen.
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

  // The palette hangs off `.nextly-admin.dark`, not `html.dark`; a sync effect
  // copies the class down after mount. Waiting for it here means a colour
  // assertion never reads a half-applied theme.
  const adminRoot = page.locator(".nextly-admin").first();
  if (theme === "dark") {
    await expect(adminRoot).toHaveClass(/\bdark\b/);
  } else {
    await expect(adminRoot).not.toHaveClass(/\bdark\b/);
  }
}

/** Relative luminance, per WCAG 2.x. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two colours, both already resolved to plain RGB.
 *
 * Computed here rather than eyeballed because 1.4.11 is a number: the control
 * borders that shipped in this admin measured 1.35:1 and 1.14:1 against a
 * requirement of 3:1, and both looked fine to everyone who saw them.
 */
export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Resolve a computed colour to RGB by letting the browser do it.
 *
 * Computed styles come back in whatever space the engine prefers — this admin
 * reports `lab(...)` — and no amount of parsing keeps up with that. Painting
 * the value onto a canvas and reading the pixel back asks the same engine that
 * rendered it.
 */
export async function toRgb(
  page: Page,
  color: string
): Promise<[number, number, number]> {
  return page.evaluate(cssColor => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, color);
}
