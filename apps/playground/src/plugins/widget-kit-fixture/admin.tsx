"use client";

/**
 * The fixture's two components, drawn from nothing but the widget kit
 * `@nextlyhq/plugin-sdk/admin` exports and the props the declaration types.
 */
import { Widget } from "@nextlyhq/plugin-sdk/admin";
import type { WidgetProps } from "@nextlyhq/plugin-sdk/widgets";
import type { JSX } from "react";

import type * as fixture from "./plugin";

/** A figure and a chart of groups, as a plugin author would compose them. */
export function KitCard({
  data,
  size,
}: WidgetProps<typeof fixture.kitCardWidget>): JSX.Element {
  return (
    <div data-testid="kit-card" data-size={size.tier}>
      <Widget.Figure value={data.total} />
      <Widget.BarChart
        title="Orders by state"
        labelHeading="State"
        groups={data.groups}
        unit={{ one: "order", other: "orders" }}
      />
    </div>
  );
}

/** Throws while it draws, so the host's per-card boundary has to catch it. */
export function ThrowingCard(): JSX.Element {
  throw new Error("The fixture card throws while it draws.");
}

/**
 * A text input with no label, planted for the accessibility check to refuse:
 * axe's `label` rule, a critical finding.
 */
export function UnlabelledControlCard({
  data,
}: WidgetProps<typeof fixture.unlabelledControlWidget>): JSX.Element {
  return (
    <div data-testid="unlabelled-control-card">
      <input type="text" defaultValue={data.query} />
    </div>
  );
}
