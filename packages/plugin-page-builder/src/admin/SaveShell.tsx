"use client";

/**
 * Page-settings header + self-persisting save bar (spec §9/§11). The custom Edit view
 * gets no save function, so this writes via the public admin REST client (adminFetch).
 * Create requires title + slug; Publish sets status; delete/cancel honor the callbacks.
 */
import { Button, Input, Label } from "@nextlyhq/ui";
import { useState } from "react";

import { deletePage, savePage } from "./api/adminFetch";
import { useEditor } from "./store/EditorProvider";
import type { CustomEditViewProps } from "./types";

export function SaveShell({ props }: { props: CustomEditViewProps }) {
  const { state, dispatch } = useEditor();
  const data = props.initialData ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const [title, setTitle] = useState(str(data.title));
  const [slug, setSlug] = useState(str(data.slug));
  const customCss = str(data.customCss); // edited via a panel in a later milestone
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: "draft" | "published") {
    if (!title.trim() || !slug.trim()) {
      setError("Title and slug are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await savePage({
        id: props.entryId,
        title,
        slug,
        content: state.document,
        customCss,
        status,
      });
      dispatch({ type: "MARK_SAVED" });
      props.onSuccess?.(entry);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!props.entryId) {
      props.onCancel?.();
      return;
    }
    setBusy(true);
    try {
      await deletePage(props.entryId);
      props.onDelete?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-end",
        flexWrap: "wrap",
      }}
    >
      <div>
        <Label htmlFor="nx-pb-title">Title</Label>
        <Input
          id="nx-pb-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="nx-pb-slug">Slug</Label>
        <Input
          id="nx-pb-slug"
          value={slug}
          onChange={e => setSlug(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void save("draft")}
        >
          Save Draft
        </Button>
        <Button disabled={busy} onClick={() => void save("published")}>
          Publish
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
          {props.entryId ? "Delete" : "Cancel"}
        </Button>
      </div>
      {error ? (
        <p
          style={{ color: "hsl(var(--destructive))", width: "100%", margin: 0 }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
