/**
 * A real image in the media library, for a spec that draws one.
 *
 * @module support/media-upload
 */
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * A 64-pixel square PNG: large enough to be pressed on the canvas, where a
 * one-pixel image gives a pointer nowhere to land.
 */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwFfGZMa3hCH8OITBAtxm7fN1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBmGYxWlLxJbIAAAAASUVORK5CYII=",
  "base64"
);

/** Store an image in the media library; returns its id and address. */
export async function uploadImage(
  request: APIRequestContext,
  run: string
): Promise<{ id: string; url: string }> {
  const uploaded = await request.post("/admin/api/media", {
    multipart: {
      file: { name: `canvas-${run}.png`, mimeType: "image/png", buffer: PNG },
    },
  });
  expect(uploaded.ok(), `uploading: ${uploaded.status()}`).toBe(true);
  const body = (await uploaded.json()) as {
    item?: { id: string; url: string };
    id?: string;
    url?: string;
  };
  return {
    id: String(body.item?.id ?? body.id),
    url: String(body.item?.url ?? body.url),
  };
}
