"use client";

/**
 * Plugin pages drawn the way a plugin author draws one: from the SDK's
 * `PageFrame` and `PageHeader` only, one page per page type, and one page that
 * draws neither and is left to the admin. The browser test measures each in the
 * real admin shell. Only kit components and inline layout are used, so nothing
 * here depends on the admin's stylesheet scanning this file.
 */
import {
  Button,
  PageFrame,
  PageHeader,
  registerComponents,
  type PageType,
} from "@nextlyhq/plugin-sdk/admin";

import { FRAME_PAGE_PATHS } from "./constants";

/** A framed page of `type`: its header, then a block of content. */
function FramedPage({ type, title }: { type: PageType; title: string }) {
  return (
    <PageFrame type={type} data-testid={`frame-${type}`}>
      <PageHeader
        title={title}
        description="A plugin page drawn with the SDK's frame and header."
        actions={<Button>Fixture action</Button>}
      />
      <div data-testid={`frame-${type}-content`}>Page content</div>
    </PageFrame>
  );
}

function FrameListPage() {
  return <FramedPage type="list" title="Fixture list page" />;
}

function FrameFormPage() {
  return <FramedPage type="form" title="Fixture form page" />;
}

/**
 * An editor lays out its own field column and a side panel, and the panel is
 * what meets the window's edge.
 */
function FrameEditorPage() {
  return (
    <PageFrame type="editor" data-testid="frame-editor">
      <div style={{ display: "flex" }}>
        <div style={{ flex: "1 1 0%", minWidth: 0 }}>
          <PageHeader title="Fixture editor page" />
          <div data-testid="frame-editor-content">Fields</div>
        </div>
        <aside
          data-testid="frame-editor-panel"
          aria-label="Fixture panel"
          style={{ width: 320, flexShrink: 0 }}
        >
          Panel
        </aside>
      </div>
    </PageFrame>
  );
}

function FrameWorkspacePage() {
  return <FramedPage type="workspace" title="Fixture workspace page" />;
}

/** A page that draws no frame and no header, as plugins did before both. */
function UnframedPage() {
  return <div data-testid="frame-none-content">Unframed page content</div>;
}

registerComponents({
  [FRAME_PAGE_PATHS["frame-list"]]: FrameListPage,
  [FRAME_PAGE_PATHS["frame-form"]]: FrameFormPage,
  [FRAME_PAGE_PATHS["frame-editor"]]: FrameEditorPage,
  [FRAME_PAGE_PATHS["frame-workspace"]]: FrameWorkspacePage,
  [FRAME_PAGE_PATHS["frame-none"]]: UnframedPage,
});
