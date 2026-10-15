/**
 * The browser half of the plugin in `widgets.ts`: its components.
 *
 * 🔴 `import type` is the whole point. The declarations hold server code (a
 * data function, a query), and a type-only import is erased, so none of it
 * reaches the browser; the component still reads its settings and its data
 * fully typed. A component would be React in a real plugin. Here it returns
 * the text it would draw, because what is under test is the types it is
 * handed, not how it renders.
 */

import type { WidgetProps } from "../../define-widget";

import type { revenue, unpaidCount } from "./widgets";

export function RevenueCard({
  settings,
  size,
  data,
}: WidgetProps<typeof revenue>) {
  const total = data.points.reduce((sum, point) => sum + point.total, 0);
  const label = settings.net ? "net" : "gross";
  return size.class === "small"
    ? `${total}`
    : `${total} ${data.currency} ${label}, ${settings.range}`;
}

export function UnpaidCard({ data }: WidgetProps<typeof unpaidCount>) {
  return data.atLeast === true ? `${data.total}+` : `${data.total}`;
}
