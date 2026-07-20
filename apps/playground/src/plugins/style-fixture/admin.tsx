"use client";

/**
 * A fixture plugin admin page that exercises all three plugin-styling layers
 * end-to-end in the real admin shell — the e2e counterpart to the unit/POC
 * coverage. Its classes are NOT in the admin's `@source` scan (only the two
 * first-party plugins are), so it genuinely depends on the safelist and its own
 * `admin.styles`. The e2e spec asserts each layer renders styled in light and
 * dark. Registration is a side-effect import, matching how a real app loads a
 * plugin's admin components.
 */
import {
  Card,
  CardContent,
  CardHeader,
  Grid,
  registerComponents,
  Stack,
  Stat,
} from "@nextlyhq/plugin-sdk/admin";

import { STYLE_FIXTURE_PATH } from "./constants";
// Layer 3: the plugin's own scoped, token-driven stylesheet (compiled from
// admin.source.css by nextly-build-admin-css). Side-effect import so the host
// bundler includes it.
import "./admin.css";

export function Showcase() {
  return (
    <Card data-testid="sf-card">
      <CardHeader>Plugin styling showcase</CardHeader>
      <CardContent>
        <Stack gap={4}>
          {/* Layer 2: safelisted, token-driven utilities (no build step). */}
          <div
            data-testid="sf-safelist"
            className="flex gap-4 rounded-md bg-card p-4 text-foreground"
          >
            <span className="text-sm text-muted-foreground">
              Safelisted utilities
            </span>
          </div>

          {/* Layer 1: kit primitives. */}
          <Grid cols={3} gap={4}>
            <Stat label="Alpha" value={1} />
            <Stat label="Beta" value={2} />
            <Stat label="Gamma" value={3} />
          </Grid>

          {/* Layer 3: a class only the plugin's admin.styles provides. */}
          <div data-testid="sf-adminstyles" className="sf-panel">
            admin.styles panel
          </div>
        </Stack>
      </CardContent>
    </Card>
  );
}

registerComponents({ [STYLE_FIXTURE_PATH]: Showcase });
