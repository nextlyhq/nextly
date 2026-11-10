/**
 * `GET` answers the note as this instance's cache holds it under the fixture
 * plugin's tag alone. `POST` has the plugin expire that tag, as it would after
 * its own data changed; it needs the `x-fixture-secret` header, as the note's
 * write does.
 */
import { connection } from "next/server";
import { getNextly } from "nextly";

import { readNoteTagged, writeRefused } from "../../../lib/note";
import {
  expirePluginNote,
  PLUGIN_NOTE_TAG,
} from "../../../nextly/cache-plugin";
import config from "../../../nextly.config";

export async function GET(): Promise<Response> {
  // A request-time read, so the answer comes from the cache rather than a
  // response prerendered at build.
  await connection();
  return Response.json({
    value: await readNoteTagged([PLUGIN_NOTE_TAG], "plugin-note"),
  });
}

export async function POST(request: Request): Promise<Response> {
  const refused = writeRefused(request);
  if (refused) return refused;
  // Started, so the plugin has been given its context.
  await getNextly({ config });
  await expirePluginNote();
  return Response.json({ expired: true });
}
