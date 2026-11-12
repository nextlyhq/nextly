"use client";

import { PageFrameListener, type PageType } from "@nextlyhq/ui";
import { useState, type ReactNode } from "react";

import {
  PageContainer,
  pageRhythm,
} from "@admin/components/layout/page-container";

import { PluginSlot } from "../plugin-slot";

interface PluginPageHostProps {
  /** Component path resolved via the registry (D19). */
  componentPath: string;
  params?: Record<string, string | string[]>;
  searchParams?: Record<string, string | string[] | undefined>;
}

/**
 * What the host's element stops saying once the page draws its own frame: it
 * is then the page's surface, not a frame, so the page has one frame and a
 * lookup by `data-page-type` finds the page's. Spread after the frame's own
 * attributes, an `undefined` here removes them.
 */
const YIELDED_FRAME: Record<`data-${string}`, undefined> = {
  "data-slot": undefined,
  "data-page-type": undefined,
};

/**
 * Renders a plugin custom page (D21). The router resolves the namespaced path
 * to a `componentPath`; this host renders it via `PluginSlot` (resolution +
 * error isolation, D53). RBAC + layout are applied by the router/RootLayout
 * (the route carries `requiredPermission` + `routeType: "private"`).
 *
 * A page that draws no `PageFrame` is drawn as a Workspace page: full width,
 * no gutter and no padding, on the page surface core's pages have. A page
 * that draws its own frame is heard through `PageFrameListener` and gets no
 * second one: the host's element keeps only the surface and the vertical
 * rhythm a core page of that type takes, and the page's frame decides its
 * width and gutter.
 *
 * One element in both states, differing only in props: the frame is heard
 * after the page has mounted, and a different element there would unmount
 * and remount the page, running its mount-time work twice. The listener
 * answers in a layout effect, so the change lands before the first paint.
 */
export function PluginPageHost({
  componentPath,
  params,
  searchParams,
}: PluginPageHostProps): ReactNode {
  // The type of the page's own outermost frame, or null while it draws none.
  const [ownFrame, setOwnFrame] = useState<PageType | null>(null);
  return (
    <PageContainer
      type="workspace"
      data-plugin-page=""
      className={ownFrame === null ? undefined : pageRhythm(ownFrame)}
      {...(ownFrame === null ? {} : YIELDED_FRAME)}
    >
      {/* Inside the host's frame, so that frame is not heard as the page's. */}
      <PageFrameListener onFrame={setOwnFrame}>
        <PluginSlot path={componentPath} props={{ params, searchParams }} />
      </PageFrameListener>
    </PageContainer>
  );
}
