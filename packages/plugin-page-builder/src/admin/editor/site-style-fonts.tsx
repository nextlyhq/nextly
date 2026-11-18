"use client";

/**
 * The fonts panel with its writes: a font file uploaded and its face declared,
 * a family removed, and the font catalogue where the site offers one.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-fonts
 */
import { validateFontFace, type FontFaceDef } from "@nextlyhq/blocks-engine";
import {
  FontsScreen,
  withoutFamily,
  type FontCatalogue,
  type FontFaceUpload,
  type FontsScreenProps,
  type SiteFamily,
} from "@nextlyhq/builder/shell";
import {
  usePluginClientConfig,
  useUploadMedia,
  WEB_FONT_FORMATS,
} from "@nextlyhq/plugin-sdk/admin";
import { useCan } from "@nextlyhq/plugin-sdk/client";
import { useCallback, useMemo, useRef } from "react";

import { catalogueFileUrl } from "../../site-fonts/contract";
import { readSiteStyleRecord } from "../../site-style-record";
import { useFontCatalogueClient, useSaveSiteStyle } from "../site-style-client";

import { toastSaveConflicts } from "./conflict-toast";
import { useVariablesStudio } from "./site-style-tokens-studio";
import { PLUGIN_SOURCE } from "./stored-document";

/**
 * The record an upload answers with, derived from the hook rather than restated.
 *
 * Naming the shape here would be this file's second opinion about what the
 * media pipeline returns, and it would go on compiling after that shape moved.
 */
type UploadedMedia = Awaited<
  ReturnType<ReturnType<typeof useUploadMedia>["mutateAsync"]>
>;

/**
 * Store a font file on this site, then declare the `@font-face` that loads it.
 *
 * Two writes that have to happen in this order and cannot be one: the file must
 * exist and have an id before anything can point at it, and a face pointing at
 * an id that was never stored is a family the page silently fails to load.
 *
 * The face is built from what upload validation SETTLED on rather than from
 * what the browser guessed — `media.mimeType` is the type the bytes were proved
 * to be, so the `format()` hint in the emitted rule cannot disagree with the
 * file the route will serve.
 *
 * @param stored - The faces already declared, which the new one is appended to
 * @returns A writer answering with a message when it refused, `undefined` when
 *   the face is stored
 */
function useFontFaceWriter(
  stored: readonly FontFaceDef[] | undefined,
  storedPending: boolean,
  unreadableFonts: readonly string[]
): {
  add: (request: FontFaceUpload) => Promise<string | undefined>;
  remove: (family: SiteFamily) => Promise<string | undefined>;
} {
  const { save: saveSiteStyle, reread } = useSaveSiteStyle();
  const { mutateAsync: uploadMedia } = useUploadMedia();
  /*
   * Every face this writer has saved, kept until the read reports it back.
   *
   * `useUpdateSingleDocument` starts its invalidation with `void`, so the save
   * resolves BEFORE the refetch that carries the new face into `stored`. An
   * author adding a family's regular and its bold in quick succession reaches
   * the second add while `stored` still describes the document as it was, and
   * a base taken from it saves the second face over the first.
   *
   * Held rather than reset on arrival, and UNIONED with `stored` below: once
   * the read catches up the two agree and the union is `stored` exactly, so
   * there is no moment when this has to be judged stale. The union is also
   * what keeps a face added from another surface in the meantime — a reset
   * base would drop it.
   */
  const written = useRef<readonly FontFaceDef[]>([]);
  /*
   * The last file that reached storage, and what it became.
   *
   * The two writes cannot be one — the bytes must have an id before a face can
   * point at one — so a refused style write leaves a stored object no face
   * references. The form keeps the `File` on a refusal so the author can fix
   * the descriptors and resubmit, and without this each attempt uploaded the
   * same bytes again: a run of validation failures left a copy per attempt.
   *
   * Keyed on the `File` itself, which is the identity the picker hands over
   * and which changes exactly when the author chooses a different file.
   */
  const uploaded = useRef<{ file: File; media: UploadedMedia } | null>(null);
  /*
   * Reload after a save met someone else's change: what this writer saved
   * ahead of the read is dropped, and the read is asked for again.
   */
  const reload = useCallback(() => {
    written.current = [];
    reread();
  }, [reread]);

  const add = useCallback(
    async (request: FontFaceUpload): Promise<string | undefined> => {
      /*
       * Refused rather than guessed at. `save` replaces the section outright,
       * so appending to a stored tier that has not arrived writes the new face
       * ALONE and discards every face already stored — and the author is told
       * it saved.
       *
       * The panel does not render the form while the read is in flight, so
       * nothing reaches this through the UI and no test drives it. It stays
       * because the callback is the host's to hand out and a boolean over a
       * value already in hand costs nothing, while the failure it prevents is
       * silent data loss.
       */
      if (storedPending) {
        return "This site's fonts are still loading. Try again in a moment.";
      }

      /*
       * Refused BEFORE the upload, because the alternative is deletion.
       *
       * `stored` is the read's value, which drops any row it cannot type, and
       * `save` replaces the section outright — so appending to it saves a list
       * those rows are missing from, and the write succeeds, because what it
       * sends is exactly what the checker approves.
       *
       * Not a capability withdrawn: `refusing` in the storage module rejects a
       * write over any issue at all, so such a row already blocks every save of
       * this section. Refusing here names it, and does so before an upload
       * whose bytes nothing would reference.
       */
      if (unreadableFonts.length > 0) {
        return `This site stores a font this version cannot read (${unreadableFonts.join(", ")}), and adding one would replace it. Repair or remove that entry first.`;
      }

      /*
       * Refused from the file's own first bytes BEFORE the upload: the media
       * pipeline takes far more than fonts, and a file stored here that no
       * face points at would stay in the media library. The type check after
       * the upload stays, for what the pipeline settles on.
       */
      const signed = await webFontFormatOf(request.file);
      if (signed === undefined) {
        return NOT_A_FONT;
      }
      // The face judged as the save will judge it, also BEFORE the upload: a
      // family the site cannot store would otherwise leave a stored file no
      // face points at.
      const problems = validateFontFace(
        {
          family: request.family,
          src: [{ url: "/api/media/pending/raw", format: signed }],
          weight: request.weight,
          style: request.style,
          source: { kind: "upload" },
        },
        "fonts"
      );
      if (problems.length > 0) {
        return problems.map(problem => problem.message).join(" ");
      }

      const stored_ = await storeOnce(request.file, uploaded, uploadMedia);
      if (typeof stored_ === "string") return stored_;
      const media = stored_;

      /*
       * The picker's `accept` is a hint a caller can bypass, and the media
       * pipeline accepts far more than fonts. A PNG stored here would be saved
       * as a face with no `format()` — which `validateFontFace` permits — and
       * the byte route answers 404 for every type outside the servable set, so
       * the site would carry a family that silently never loads.
       *
       * Decided on the type upload validation SETTLED on rather than the one
       * the browser guessed, which is the same value the route will check the
       * bytes against.
       */
      const format = fontFormatFor(media.mimeType);
      if (format === undefined) {
        return NOT_A_FONT;
      }

      const face: FontFaceDef = {
        family: request.family,
        /*
         * The route that serves bytes to a reader with no session. A stored
         * media URL is not usable here: `validateFontFace` refuses anything
         * carrying a scheme or an authority, and a backend that stores absolute
         * URLs would produce exactly that.
         */
        src: [{ url: `/api/media/${media.id}/raw`, format }],
        weight: request.weight,
        style: request.style,
        // So the Fonts tab can say it was uploaded rather than downloaded.
        source: { kind: "upload" },
      };

      // The faces this add was made from, which the save is merged onto
      // the stored ones from: a face added elsewhere meanwhile is kept.
      const base = appendBase(stored, written.current);
      const next = [...base, face];
      const result = await saveSiteStyle("fonts", next, { base });
      toastSaveConflicts("fonts", result, reload);
      if (result.saved) {
        // Stored and referenced, so the next add starts clean rather than
        // pointing a second face at the first face's bytes.
        uploaded.current = null;
        written.current = facesAfterSave(result, next);
        return undefined;
      }
      /*
       * Joined rather than picked from, for the reason the breakpoint writer
       * joins: `issues` is keyed by path, and taking the first tells an author
       * about one refused field while a second is also refused.
       */
      const reasons = Object.values(result.issues);
      return reasons.length > 0
        ? reasons.join(" ")
        : "That font could not be saved.";
    },
    [saveSiteStyle, stored, storedPending, unreadableFonts, uploadMedia, reload]
  );

  /*
   * Remove a family's stored faces, through the same section write and so
   * one step of the editor's undo history. The files stay in the media
   * library: another page or face may still point at them.
   */
  const remove = useCallback(
    async (family: SiteFamily): Promise<string | undefined> => {
      if (storedPending) {
        return "This site's fonts are still loading. Try again in a moment.";
      }
      if (unreadableFonts.length > 0) {
        return `This site stores a font this version cannot read (${unreadableFonts.join(", ")}), and removing one would replace it. Repair or remove that entry first.`;
      }
      const base = appendBase(stored, written.current);
      const next = withoutFamily(base, family.key);
      const result = await saveSiteStyle("fonts", next, { base });
      toastSaveConflicts("fonts", result, reload);
      if (result.saved) {
        // Forgotten here too, or the next upload would put it back; the
        // merge as stored, where the save met a newer one.
        written.current =
          result.stored === undefined
            ? withoutFamily(written.current, family.key)
            : facesAfterSave(result, next);
        return undefined;
      }
      const reasons = Object.values(result.issues);
      return reasons.length > 0
        ? reasons.join(" ")
        : `${family.family} could not be removed.`;
    },
    [saveSiteStyle, stored, storedPending, unreadableFonts, reload]
  );

  return { add, remove };
}

/**
 * The faces a stored save leaves: the merge as stored, read as the editor
 * reads the document, when the save was merged onto a newer copy, else the
 * faces sent.
 */
function facesAfterSave(
  result: { readonly stored?: unknown },
  sent: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  return result.stored === undefined
    ? sent
    : (readSiteStyleRecord({ fonts: result.stored }).fonts ?? []);
}

/**
 * Everything a new face must be saved alongside: what was read, plus what this
 * writer saved that the read has not reported back yet.
 *
 * A union rather than a choice between the two. Picking `written` while it
 * looks ahead would drop a face added from another surface since; picking
 * `stored` drops the one just saved. Order follows `stored`, so a face keeps
 * the position the document gives it and an unreported one lands after —
 * where it will be once the read catches up.
 *
 * @param stored - The read's faces, or `undefined` before it arrives
 * @param written - Faces this writer has saved, oldest first
 * @returns The faces to append to
 */
function appendBase(
  stored: readonly FontFaceDef[] | undefined,
  written: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  const base = stored ?? [];
  const present = new Set(base.map(faceIdentity));
  return [...base, ...written.filter(face => !present.has(faceIdentity(face)))];
}

/**
 * What makes two face records the same stored row.
 *
 * The sources carry it: a face added here points at one media object, whose id
 * is minted by the upload, so two adds never collide and a re-read of the same
 * row always matches. Family, weight and style join it because a document may
 * legitimately point two faces at one file — a variable font serving both an
 * upright and a synthesised oblique is the ordinary case.
 */
function faceIdentity(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/**
 * The Google Fonts catalogue as the Fonts tab reads it: through the server,
 * with previews from the file host the server names. `undefined` when the
 * host turned the catalogue off.
 */
export function useFontCatalogue(): FontCatalogue | undefined {
  const config = usePluginClientConfig(PLUGIN_SOURCE);
  const client = useFontCatalogueClient();
  // The file host the last read named, which previews are built under. Rows
  // exist only once a read has answered, so it is set before it is asked.
  const previewBase = useRef("");
  const off = config?.fontCatalogue === false;
  return useMemo(
    () =>
      off
        ? undefined
        : {
            load: async (signal: AbortSignal) => {
              const read = await client.load(signal);
              previewBase.current = read.previewBase;
              return read;
            },
            previewUrl: (family, weight, style) =>
              catalogueFileUrl(previewBase.current, {
                id: family.id,
                version: "latest",
                subset: family.defSubset,
                weight,
                style,
              }),
            add: client.add,
          },
    [off, client]
  );
}

/**
 * The one Fonts screen, with the writers that add and remove a face and the
 * catalogue: what the builder opens over its Design panel and the admin's
 * Fonts page draws, so every way in writes through the same site-style client.
 *
 * Its own component rather than more hooks in the editor: a screen that needs
 * writers is the thing that should own them. Shown read-only to a role
 * without `update-site-style`, which the server would refuse anyway.
 */
export function SiteFontsScreen({
  faces,
  codeFaces,
  tokens,
  absence,
  onOpenTokens,
  onOpenRole,
  onClose,
  labelledBy,
  storedFaces,
  storedPending,
  unreadableFonts,
}: Pick<
  FontsScreenProps,
  | "faces"
  | "codeFaces"
  | "tokens"
  | "absence"
  | "onOpenTokens"
  | "onOpenRole"
  | "onClose"
  | "labelledBy"
> & {
  storedFaces: readonly FontFaceDef[] | undefined;
  storedPending: boolean;
  unreadableFonts: readonly string[];
}): React.JSX.Element {
  const mayChange = useCan("update-site-style");
  const writer = useFontFaceWriter(storedFaces, storedPending, unreadableFonts);
  const catalogue = useFontCatalogue();
  // Inside the Variables studio, as the Design panel and the admin's Fonts
  // page mount it, the screen reads the studio's variables and their usage
  // and writes the Body and Headings fonts through it, so a role set here
  // is one variable edit the studio saves (and, in the builder, undoes).
  const studio = useVariablesStudio();
  const writes = studio !== null && studio.readOnly !== true;
  return (
    <FontsScreen
      absence={absence}
      acceptFiles={FONT_FILE_ACCEPT}
      faces={faces}
      codeFaces={codeFaces}
      readOnly={!mayChange}
      onAddFace={writer.add}
      onRemoveFamily={writer.remove}
      catalogue={catalogue}
      tokens={studio?.tokens ?? tokens}
      {...(studio?.usage === undefined ? {} : { usage: studio.usage })}
      {...(writes ? { onTokensChange: studio.onChange } : {})}
      {...(studio?.supplied?.siteText === undefined
        ? {}
        : { suppliedText: studio.supplied.siteText })}
      {...(onOpenRole === undefined ? {} : { onOpenRole })}
      {...(onOpenTokens === undefined ? {} : { onOpenTokens })}
      {...(onClose === undefined ? {} : { onClose })}
      {...(labelledBy === undefined ? {} : { labelledBy })}
    />
  );
}

/**
 * Put a file on this site, at most once per file.
 *
 * The two writes an added face needs cannot be one — the bytes must have an id
 * before a face can point at one — so a refused style write leaves a stored
 * object no face references. The form keeps the `File` on a refusal so the
 * author can correct the descriptors and press Add again, and re-uploading on
 * each attempt turned a run of refusals into a copy per attempt.
 *
 * @param file - What the author chose, and the identity this remembers by
 * @param seen - Where the last stored file and its record are kept
 * @param upload - The media pipeline's own mutation
 * @returns The stored record, or a message the author can act on
 */
async function storeOnce(
  file: File,
  seen: React.MutableRefObject<{ file: File; media: UploadedMedia } | null>,
  upload: (input: { file: File }) => Promise<UploadedMedia>
): Promise<UploadedMedia | string> {
  const remembered = seen.current;
  if (remembered !== null && remembered.file === file) return remembered.media;

  try {
    const media = await upload({ file });
    seen.current = { file, media };
    return media;
  } catch (reason) {
    /*
     * The upload's own refusal, which is the one an author can act on: it names
     * the format, the size cap or the signature mismatch. Replacing it with
     * wording of our own would describe a policy this surface does not hold.
     */
    return reason instanceof Error
      ? reason.message
      : "That file could not be uploaded.";
  }
}

const NOT_A_FONT =
  "This file isn\u2019t a .woff2 or .woff font, so it wasn\u2019t added.";

/**
 * The `format()` keyword of the web font a file begins as, by its signature,
 * read from the same table the upload gate checks the bytes against; nothing
 * when it begins as none.
 */
async function webFontFormatOf(file: File): Promise<string | undefined> {
  // `FileReader` rather than `Blob.arrayBuffer()`, which not every DOM the
  // admin runs in provides.
  const head = await new Promise<Uint8Array>(resolve => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(
        reader.result instanceof ArrayBuffer
          ? new Uint8Array(reader.result)
          : new Uint8Array(0)
      );
    reader.onerror = () => resolve(new Uint8Array(0));
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
  const text = String.fromCharCode(...head);
  return WEB_FONT_FORMATS.find(format => format.signature === text)
    ?.formatKeyword;
}

/**
 * The `format()` hint for a validated media type.
 *
 * Read from the same table the upload gate, the public byte route and the
 * admin dropzone read, so this panel cannot come to disagree with any of them
 * about what a web font is. A restated map is the shape that drifts: a format
 * core adds would be stored and served while this panel refused the type it
 * had just accepted, and the author would see a font the site handles
 * everywhere except the one screen offering to add it.
 *
 * An unrecognised type contributes no hint at all rather than a guessed one:
 * `format()` is advisory, and a browser told the wrong format skips the source
 * entirely.
 */
function fontFormatFor(mimeType: string): string | undefined {
  const settled = mimeType.toLowerCase().trim();
  return WEB_FONT_FORMATS.find(format => format.mimeType === settled)
    ?.formatKeyword;
}

/**
 * What the file picker offers, in the two vocabularies a picker accepts.
 *
 * Both, because neither alone is enough. A `.woff2` chosen from disk is
 * reported with no type at all on the platforms that do not carry fonts in
 * their registry, so a types-only `accept` hides the file the author came to
 * add; an extensions-only one hides a font handed over by a tool that names it
 * correctly and spells it differently.
 */
const FONT_FILE_ACCEPT: string = WEB_FONT_FORMATS.flatMap(format => [
  format.extension,
  format.mimeType,
]).join(",");
