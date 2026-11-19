/**
 * "Choose what to publish"'s refusal beside a part reads at AA's 4.5:1 for small text on the
 * dialog's own surface, in light and dark.
 *
 * jsdom computes no stylesheet, so the colour a class paints is resolved from the theme file:
 * the words' `text-*` class as drawn, against the `bg-*` class the dialog is drawn with. The
 * plausible broken line is one in the destructive red, a fill's colour that measures 3.73:1 on
 * the light dialog.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";

import {
  compositeOver,
  contrastRatio,
} from "../../../../../../../ui/src/styles/contrast/color";
import {
  parseThemeScale,
  parseThemeTokens,
} from "../../../../../../../ui/src/styles/contrast/parse-theme";
import {
  resolveColor,
  type ResolveContext,
} from "../../../../../../../ui/src/styles/contrast/resolve";
import { PublishPartsDialog } from "../PublishPartsDialog";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(
  resolve(here, "../../../../../../../ui/src/styles/theme.css"),
  "utf8"
);
const theme = parseThemeTokens(themeCss);
const scale = parseThemeScale(themeCss);
const MODES: Record<"light" | "dark", ResolveContext> = {
  light: { tokens: theme.light, scale },
  dark: { tokens: theme.dark, scale },
};

/** AA for small text. */
const SMALL_TEXT = 4.5;

const REFUSAL = 'The "es" language has no current approval.';

/** The theme colour token a resting `<prefix>-*` class in `className` paints. */
function tokenOf(className: string, prefix: "text" | "bg"): string {
  for (const name of className.split(/\s+/)) {
    if (name.includes(":")) continue;
    const token = new RegExp(`^${prefix}-([a-z-]+)$`).exec(name)?.[1];
    if (token && scale.has(`--color-${token}`)) return token;
  }
  throw new Error(`no theme ${prefix} colour in "${className}"`);
}

beforeEach(() => {
  api.publishParts.mockReset();
  api.findByID.mockReset();
  // The server's description refuses Spanish, which the dialog says beside it.
  api.publishParts.mockRejectedValue(
    parseApiError(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          requestId: "r1",
          data: {
            errors: [
              {
                path: "es",
                locale: "es",
                code: "NOT_APPROVED",
                message: REFUSAL,
              },
            ],
          },
        },
      },
      400
    )
  );
  api.findByID.mockResolvedValue({ id: "post-1", _rev: "7" });
});

describe("a part's refusal in Choose what to publish", () => {
  it("reads at 4.5:1 on the dialog, in light and dark", async () => {
    render(
      <PublishPartsDialog
        open
        onOpenChange={() => undefined}
        target={{ kind: "collection", slug: "posts", id: "post-1" }}
        direction="publish"
        languages={["en", "es"]}
        labelOf={code => code}
        initialChoice={{ locales: ["es"], shared: false }}
      />
    );
    const line = await screen.findByText(REFUSAL);
    const ink = tokenOf(line.getAttribute("class") ?? "", "text");
    const surface = tokenOf(
      screen.getByRole("dialog").getAttribute("class") ?? "",
      "bg"
    );
    for (const [mode, ctx] of Object.entries(MODES)) {
      const ground = resolveColor(`var(--color-${surface})`, ctx);
      const words = compositeOver(
        resolveColor(`var(--color-${ink})`, ctx),
        ground
      );
      const ratio = contrastRatio(words, ground);
      expect(
        ratio,
        `text-${ink} reads ${ratio.toFixed(2)}:1 on bg-${surface} in ${mode}`
      ).toBeGreaterThanOrEqual(SMALL_TEXT);
    }
  });
});
