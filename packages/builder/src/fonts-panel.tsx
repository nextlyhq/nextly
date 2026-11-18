/**
 * The Fonts tab of the Design panel: the fonts on this site, the site's font
 * variables, and the two ways a font gets here — from the Google Fonts
 * catalogue, downloaded to the site, or uploaded as a file.
 *
 * Drawn in the Variables tab's language: a search, small-caps groups, compact
 * rows, and each row's details in a 240px editor beside the panel.
 *
 * ## Every family is drawn in itself
 *
 * A row's "Aa" and each style in its details are set in the face they name,
 * so a family the site has no file for shows the fallback, and an author sees
 * the substitution rather than reading about it.
 *
 * ## It authors no variables
 *
 * The Variables tab creates and edits `fontFamily` variables. This tab lists
 * them with a note when one asks first for a font the site has no file for,
 * and sends the author to Variables to change it: one editor for one question.
 *
 * @module fonts-panel
 */
import { cssString, tokenDisplayLabel } from "@nextlyhq/blocks-engine";
import type {
  FontFaceDef,
  SiteTextMap,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { ArrowLeft, Plus, Search } from "lucide-react";
import * as React from "react";

import { EDITOR_WORDS } from "./editor-words";
import { FontCatalogueView, type FontCatalogue } from "./font-catalogue-view";
import {
  cutName,
  familyDescription,
  fontTokenRows,
  siteFamilies,
  SPECIMEN,
  specimenText,
  specimenWeight,
  tokenNotes,
  type FontTokenRow,
  type SiteFamily,
} from "./font-library";
import { FontUploadEditor, type FontFaceUpload } from "./font-upload-editor";
import {
  FallbackList,
  RoleRefusal,
  UseForQuestion,
  useFamiliesUses,
  useUseFor,
  WhereUsed,
  type FamilyUsesHere,
} from "./font-uses-view";
import { KeepOrRemove, Refusal, useRefusableWrite } from "./panel-actions";
import type { FontRole } from "./site-font-roles-model";
import type { VariablesAccess } from "./variable-usage";

export type { FontFaceUpload } from "./font-upload-editor";
export type {
  CatalogueAddRequest,
  CatalogueFamilyView,
  FontCatalogue,
} from "./font-catalogue-view";

export interface FontsPanelProps {
  /**
   * Every face the page emits, or `undefined` while the host has not read
   * them. A real third state: a site may legitimately have no faces.
   */
  faces: readonly FontFaceDef[] | undefined;
  /** The faces the site's code supplies, which this tab cannot remove. */
  codeFaces?: readonly FontFaceDef[];
  /** The site's variables, whose `fontFamily` members this lists. */
  tokens: SiteTokenSet | undefined;
  /** Why the faces are absent, when they are. */
  absence?: "pending" | "failed";
  /** Shown, never changed: no add, no remove. */
  readOnly?: boolean;
  /** Open the Variables tab, where a font variable is changed. */
  onOpenTokens?: () => void;
  /**
   * Upload a font file. Resolves to a message when the host refused and to
   * `undefined` when it stored one. Absent hides the upload.
   */
  onAddFace?: (request: FontFaceUpload) => Promise<string | undefined>;
  /** What the file picker offers, as an `accept` attribute. */
  acceptFiles?: string;
  /**
   * Remove a family's stored faces. Resolves to a message when refused.
   * The files stay in the media library.
   */
  onRemoveFamily?: (family: SiteFamily) => Promise<string | undefined>;
  /** The Google Fonts catalogue, when the host offers one. */
  catalogue?: FontCatalogue;
  /**
   * How widely the site's variables are used, read for the font variables
   * naming each font, so its details say how many places use it. Absent,
   * no places are said.
   *
   * @experimental Settles with the Fonts screen.
   */
  usage?: VariablesAccess;
  /**
   * Open the Body or Headings font's picker, where a font's "Body font" or
   * "Headings font" links. Absent, those are said, not linked.
   *
   * @experimental Settles with the Fonts screen.
   */
  onOpenRole?: (role: FontRole) => void;
  /**
   * Write the site's variables, so a font that finishes adding can be made
   * the Body or Headings font at once. Absent, that is not asked.
   *
   * @experimental Settles with the Fonts screen.
   */
  onTokensChange?: (tokens: SiteTokenSet) => void;
  /**
   * The Site text rows the site's code supplies, which setting or taking
   * back a role keeps.
   *
   * @experimental Settles with the Fonts screen.
   */
  suppliedText?: SiteTextMap;
}

/** What the Fonts screen adds to the list it draws: where it opens. */
export interface FontsScreenProps extends FontsPanelProps {
  /**
   * Close the screen, back to Design, where it opens over the Design panel.
   * Absent where it is a page of its own, which has no "back".
   */
  onClose?: () => void;
  /**
   * The id of the heading that names the screen, where the page around it
   * draws one. Absent, the screen draws its own "Fonts" title.
   */
  labelledBy?: string;
}

/**
 * The one Fonts screen: the site's fonts, adding and removing them, under a
 * "Fonts" heading. Every way in mounts this, so the builder (over its Design
 * panel, from Design → Type or a font picker's "Manage fonts…") and the
 * admin's own Fonts page show the same screen and behave the same; the host
 * hands each the same writers.
 *
 * @param props - The list's inputs, and where the screen opens
 * @returns The screen
 */
export function FontsScreen({
  onClose,
  labelledBy,
  ...panel
}: FontsScreenProps): React.JSX.Element {
  const ownTitle = React.useId();
  const back = React.useRef<HTMLButtonElement>(null);
  // Opened over Design, the keyboard follows: the screen took the panel's
  // place, so focus left behind would be on nothing.
  const opensOver = onClose !== undefined && labelledBy === undefined;
  React.useEffect(() => {
    if (opensOver) back.current?.focus();
  }, [opensOver]);
  return (
    <section
      className="nx-fonts-screen"
      aria-labelledby={labelledBy ?? ownTitle}
      data-fonts-screen=""
    >
      {labelledBy === undefined ? (
        <div className="nx-fonts-screen__head">
          {onClose === undefined ? null : (
            <button
              ref={back}
              type="button"
              className="nx-vars__icon-button nx-fonts-screen__back"
              aria-label={`Back to ${EDITOR_WORDS.design}`}
              title={`Back to ${EDITOR_WORDS.design}`}
              onClick={onClose}
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
          )}
          <h2 className="nx-fonts-screen__title" id={ownTitle}>
            {EDITOR_WORDS.fonts}
          </h2>
        </div>
      ) : null}
      <FontsPanel {...panel} />
    </section>
  );
}

/**
 * The tab's place names inside a sentence, from the editor's one catalogue of
 * them, so a rename of the tab moves its sentences with it.
 */
function words(): { fonts: string; variables: string } {
  return {
    fonts: EDITOR_WORDS.fonts.toLowerCase(),
    variables: EDITOR_WORDS.variables.toLowerCase(),
  };
}

/** What the tab shows: the site's fonts, or the catalogue in their place. */
type View = { kind: "list" } | { kind: "catalogue"; query: string };

export function FontsPanel({
  faces,
  codeFaces = [],
  tokens,
  absence = "pending",
  readOnly = false,
  onOpenTokens,
  onAddFace,
  acceptFiles,
  onRemoveFamily,
  catalogue,
  usage,
  onOpenRole,
  onTokensChange,
  suppliedText,
}: FontsPanelProps): React.JSX.Element {
  const [view, setView] = React.useState<View>({ kind: "list" });
  const addButton = React.useRef<HTMLButtonElement>(null);
  const families = React.useMemo(
    () => (faces === undefined ? [] : siteFamilies(faces, codeFaces)),
    [faces, codeFaces]
  );
  const usesOf = useFamiliesUses(families, tokens, usage);
  // Asked once a font finishes adding, from the catalogue or a file.
  const useFor = useUseFor({
    tokens,
    faces: faces ?? [],
    codeFaces,
    onTokensChange: readOnly ? undefined : onTokensChange,
    suppliedText,
  });
  const question =
    useFor.asked === null ? null : (
      <UseForQuestion family={useFor.asked.family} onAnswer={useFor.answer} />
    );

  if (faces === undefined) return <Unread absence={absence} />;

  if (view.kind === "catalogue" && catalogue !== undefined) {
    return (
      <>
        {question}
        <FontCatalogueView
          catalogue={catalogue}
          initialQuery={view.query}
          onSite={families}
          onAdded={useFor.ask}
          onBack={() => {
            setView({ kind: "list" });
            // Back on the list, focus returns to where the catalogue was
            // opened.
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      </>
    );
  }

  return (
    <FontsList
      families={families}
      question={question}
      faces={faces}
      tokens={tokens}
      readOnly={readOnly}
      addButton={addButton}
      onOpenTokens={onOpenTokens}
      onOpenRole={onOpenRole}
      usesOf={usesOf}
      onRemoveFamily={onRemoveFamily}
      onBrowse={
        readOnly || catalogue === undefined
          ? undefined
          : (query = "") => setView({ kind: "catalogue", query })
      }
      upload={
        readOnly || onAddFace === undefined
          ? undefined
          : {
              onAddFace: async request => {
                const refusal = await onAddFace(request);
                if (refusal === undefined) useFor.ask(request.family);
                return refusal;
              },
              acceptFiles,
            }
      }
    />
  );
}

/** The site's fonts and font variables: the tab's list view. */
function FontsList({
  families,
  faces,
  tokens,
  readOnly,
  addButton,
  onOpenTokens,
  onOpenRole,
  usesOf,
  question,
  onRemoveFamily,
  onBrowse,
  upload,
}: {
  families: readonly SiteFamily[];
  /**
   * "Use <font> for", once a font finishes adding: in the upload editor
   * while it is open, which holds the rest of the screen inert, else at the
   * top of the list.
   */
  question: React.ReactNode;
  faces: readonly FontFaceDef[];
  tokens: SiteTokenSet | undefined;
  readOnly: boolean;
  addButton: React.RefObject<HTMLButtonElement | null>;
  onOpenTokens: (() => void) | undefined;
  onOpenRole: FontsPanelProps["onOpenRole"];
  /** Where each family is used, by its key. */
  usesOf: (key: string) => FamilyUsesHere;
  onRemoveFamily: FontsPanelProps["onRemoveFamily"];
  onBrowse: ((query?: string) => void) | undefined;
  upload:
    | {
        onAddFace: (request: FontFaceUpload) => Promise<string | undefined>;
        acceptFiles: string | undefined;
      }
    | undefined;
}): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const search = React.useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const shownFamilies = families.filter(family =>
    family.family.toLowerCase().includes(needle)
  );
  const rows = fontTokenRows(tokens, faces).filter(
    row =>
      labelOf(row).toLowerCase().includes(needle) ||
      row.token.name.toLowerCase().includes(needle)
  );
  const { fonts } = words();
  const openUpload =
    upload === undefined ? undefined : () => setUploading(true);

  return (
    <div
      className="nx-vars nx-fonts"
      data-read-only={readOnly ? "" : undefined}
    >
      <div className="nx-vars__search">
        <Search aria-hidden="true" size={16} />
        <Input
          ref={search}
          type="search"
          aria-label={`Search ${fonts}`}
          placeholder={`Search ${fonts}`}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      <div className="nx-vars__body">
        {uploading ? null : question}
        {readOnly ? (
          <p className="nx-vars__note">
            {`You can view the site’s ${fonts} but not change them.`}
          </p>
        ) : null}
        <Popover open={uploading} onOpenChange={setUploading} modal>
          <section className="nx-vars__group" aria-labelledby="nx-fonts-site">
            <PopoverAnchor asChild>
              <div className="nx-vars__group-head">
                <h3 className="nx-vars__group-name" id="nx-fonts-site">
                  On this site
                </h3>
                {onBrowse === undefined && openUpload === undefined ? null : (
                  <AddFontMenu
                    trigger={addButton}
                    onBrowse={
                      onBrowse === undefined ? undefined : () => onBrowse()
                    }
                    onUpload={openUpload}
                  />
                )}
              </div>
            </PopoverAnchor>
            <SiteFamilies
              families={shownFamilies}
              searching={needle !== ""}
              query={query.trim()}
              readOnly={readOnly}
              usesOf={usesOf}
              opens={{ onOpenRole, onOpenTokens }}
              onRemoveFamily={onRemoveFamily}
              onRemoved={() => search.current?.focus()}
              onBrowse={onBrowse}
              onUpload={openUpload}
            />
          </section>
          {upload === undefined ? null : (
            <PopoverContent
              side="right"
              align="start"
              sideOffset={12}
              className="nx-vars-editor"
              aria-label="Upload a font file"
            >
              {question}
              <FontUploadEditor
                onAddFace={upload.onAddFace}
                acceptFiles={upload.acceptFiles}
              />
            </PopoverContent>
          )}
        </Popover>
        {needle !== "" && rows.length === 0 ? null : (
          <FontVariables
            rows={rows}
            faces={faces}
            onOpenTokens={onOpenTokens}
          />
        )}
        <p className="nx-vars__note nx-fonts__privacy">
          Fonts are stored on your site. Visitors&rsquo; browsers never contact
          Google.
        </p>
      </div>
    </div>
  );
}

/** What shows while the fonts are being read, or after a read failed. */
function Unread({
  absence,
}: {
  absence: "pending" | "failed";
}): React.JSX.Element {
  const failed = absence === "failed";
  const { fonts } = words();
  return (
    <div className="nx-vars nx-fonts">
      <div className="nx-vars__body">
        <p
          className={failed ? "nx-vars__alert" : "nx-vars__note"}
          role={failed ? "alert" : "status"}
        >
          {failed
            ? `This site’s ${fonts} could not be read, so none can be shown or changed. Reload to try again.`
            : `Reading this site’s ${fonts}…`}
        </p>
      </div>
    </div>
  );
}

/** The group's "+": a menu of the ways a font can be added. */
function AddFontMenu({
  trigger,
  onBrowse,
  onUpload,
}: {
  trigger: React.RefObject<HTMLButtonElement | null>;
  onBrowse: (() => void) | undefined;
  onUpload: (() => void) | undefined;
}): React.JSX.Element {
  // Set while a choice opens something else, so the menu does not hand focus
  // back to its button and close what was just opened.
  const handingOff = React.useRef(false);
  const choose = (action: () => void) => () => {
    handingOff.current = true;
    action();
  };
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className="nx-vars__icon-button nx-vars__add"
          aria-label="Add a font"
          title="Add a font"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="nx-vars__menu"
        onCloseAutoFocus={event => {
          if (handingOff.current) event.preventDefault();
          handingOff.current = false;
        }}
      >
        {onBrowse === undefined ? null : (
          <DropdownMenuItem onSelect={choose(onBrowse)}>
            From Google Fonts
          </DropdownMenuItem>
        )}
        {onUpload === undefined ? null : (
          <DropdownMenuItem onSelect={choose(onUpload)}>
            Upload a font file
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The site's families as rows, or what to say when there are none. */
function SiteFamilies({
  families,
  searching,
  query,
  readOnly,
  usesOf,
  opens,
  onRemoveFamily,
  onRemoved,
  onBrowse,
  onUpload,
}: {
  families: readonly SiteFamily[];
  searching: boolean;
  query: string;
  readOnly: boolean;
  usesOf: (key: string) => FamilyUsesHere;
  opens: UsesOpeners;
  onRemoveFamily: FontsPanelProps["onRemoveFamily"];
  onRemoved: () => void;
  onBrowse: ((query?: string) => void) | undefined;
  onUpload: (() => void) | undefined;
}): React.JSX.Element {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const { fonts } = words();
  if (families.length === 0 && searching) {
    return (
      <p className="nx-vars__empty">
        {`No ${fonts} on this site match this search.`}
        {onBrowse === undefined ? null : (
          <button
            type="button"
            className="nx-vars__link"
            onClick={() => onBrowse(query)}
          >
            {`Search Google Fonts for “${query}”`}
          </button>
        )}
      </p>
    );
  }
  if (families.length === 0) {
    return (
      <p className="nx-vars__empty">
        {`No ${fonts} on this site yet, so pages use the system font.`}
        {onBrowse === undefined ? null : (
          <button
            type="button"
            className="nx-vars__link"
            onClick={() => onBrowse()}
          >
            Add from Google Fonts
          </button>
        )}
        {onUpload === undefined ? null : (
          <button type="button" className="nx-vars__link" onClick={onUpload}>
            Upload a font file
          </button>
        )}
      </p>
    );
  }
  return (
    <ul className="nx-vars__list">
      {families.map(family => (
        <FamilyRow
          key={family.key}
          family={family}
          open={openKey === family.key}
          onOpenChange={open => setOpenKey(open ? family.key : null)}
          here={usesOf(family.key)}
          opens={opens}
          onRemove={
            readOnly || !family.removable || onRemoveFamily === undefined
              ? undefined
              : async () => {
                  const refusal = await onRemoveFamily(family);
                  if (refusal === undefined) {
                    setOpenKey(null);
                    onRemoved();
                  }
                  return refusal;
                }
          }
        />
      ))}
    </ul>
  );
}

/** A face's own descriptors, so a specimen draws in that exact face. */
function faceStyle(face: FontFaceDef): React.CSSProperties {
  const weight = specimenWeight(face.weight);
  return {
    // Escaped as the site sheet writes the same name, or a legal family with
    // a quote in it would draw in the fallback.
    fontFamily: `"${cssString(face.family)}"`,
    ...(weight === undefined ? {} : { fontWeight: weight }),
    ...(face.style === undefined ? {} : { fontStyle: face.style }),
  };
}

/** One family: a row that opens its details beside the panel. */
function FamilyRow({
  family,
  open,
  onOpenChange,
  here,
  opens,
  onRemove,
}: {
  family: SiteFamily;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  here: FamilyUsesHere;
  opens: UsesOpeners;
  onRemove: (() => Promise<string | undefined>) | undefined;
}): React.JSX.Element {
  return (
    <li>
      <Popover open={open} onOpenChange={onOpenChange} modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-vars__row"
            aria-label={familyDescription(family)}
            data-font-family={family.key}
          >
            <span
              className="nx-vars__specimen nx-fonts__lead"
              aria-hidden="true"
              style={{ fontFamily: `"${cssString(family.family)}"` }}
            >
              Aa
            </span>
            {/* Cut with an ellipsis when long, so the name is whole on hover. */}
            <span className="nx-vars__name" title={family.family}>
              {family.family}
            </span>
            <span className="nx-vars__chip" aria-hidden="true">
              {family.styles}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="nx-vars-editor"
          aria-label={family.family}
        >
          <FamilyDetails
            family={family}
            here={here}
            opens={opens}
            onRemove={onRemove}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

/** Where a family came from, as its details say it. */
function sourceLine(family: SiteFamily): string {
  if (family.origin === "code") return "Set in your site’s code";
  if (family.origin === "upload") return "Uploaded";
  return family.licence === undefined
    ? "From Google Fonts"
    : `From Google Fonts · ${family.licence}`;
}

/** A family's details: its name and sample in itself, each style, its source. */
function FamilyDetails({
  family,
  here,
  opens,
  onRemove,
}: {
  family: SiteFamily;
  here: FamilyUsesHere;
  opens: UsesOpeners;
  onRemove: (() => Promise<string | undefined>) | undefined;
}): React.JSX.Element {
  const first = family.faces[0];
  const cuts = new Map<string, FontFaceDef>();
  for (const face of family.faces) {
    const name = cutName(face.weight, face.style);
    if (!cuts.has(name)) cuts.set(name, face);
  }
  return (
    <div className="nx-vars-editor__body">
      <div className="nx-fonts__heading">
        <span
          className="nx-fonts__title"
          style={first === undefined ? undefined : faceStyle(first)}
        >
          {family.family}
        </span>
        <span
          className="nx-fonts__sample"
          style={first === undefined ? undefined : faceStyle(first)}
        >
          {first === undefined ? SPECIMEN : specimenText(first)}
        </span>
      </div>
      <div className="nx-vars-editor__field">
        <span className="nx-vars-editor__label">Styles</span>
        <ul className="nx-fonts__styles">
          {[...cuts].map(([name, face]) => (
            <li key={name} style={faceStyle(face)}>
              {name}
            </li>
          ))}
        </ul>
      </div>
      <p className="nx-fonts__meta">{sourceLine(family)}</p>
      <WhereUsed
        here={here}
        onOpenRole={opens.onOpenRole}
        onOpenTokens={opens.onOpenTokens}
      />
      {onRemove === undefined ? null : (
        <RemoveFamily
          family={family.family}
          keepsCode={family.origin === "code"}
          here={here}
          onOpenRole={opens.onOpenRole}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

/** Where a family's details send the author: a role's picker, the variables. */
interface UsesOpeners {
  readonly onOpenRole: FontsPanelProps["onOpenRole"];
  readonly onOpenTokens: (() => void) | undefined;
}

/**
 * Remove, behind a confirmation naming what happens to the text and files:
 * refused for the Body or Headings font, which must be changed first, and
 * naming each font variable that loses the font with what it falls back to.
 */
function RemoveFamily({
  family,
  keepsCode,
  here,
  onOpenRole,
  onRemove,
}: {
  family: string;
  /** Whether the site's code supplies some of its styles, which stay. */
  keepsCode: boolean;
  here: FamilyUsesHere;
  onOpenRole: FontsPanelProps["onOpenRole"];
  onRemove: () => Promise<string | undefined>;
}): React.JSX.Element {
  const [confirming, setConfirming] = React.useState(false);
  const { busy, refusal, run } = useRefusableWrite();
  // The styles the site's code supplies stay, so the family keeps its uses.
  const refused = !keepsCode && here.uses.roles.length > 0;
  return (
    <>
      <Refusal refusal={refusal} />
      {confirming && refused ? (
        <RoleRefusal
          family={family}
          roles={here.uses.roles}
          onOpenRole={onOpenRole}
          onBack={() => setConfirming(false)}
        />
      ) : confirming ? (
        <div
          className="nx-vars-editor__confirm"
          role="group"
          aria-label={`Remove ${family}`}
        >
          {keepsCode ? (
            <p>
              Remove the <strong>{family}</strong> styles you added here? Styles
              from your site&rsquo;s code stay. The files stay in your media
              library.
            </p>
          ) : here.uses.variables.length > 0 ? (
            <FallbackList family={family} here={here} />
          ) : (
            <p>
              Remove <strong>{family}</strong>? Text set in it falls back to the
              next font in its list. The files stay in your media library.
            </p>
          )}
          <KeepOrRemove
            busy={busy}
            onKeep={() => setConfirming(false)}
            onRemove={() => void run(onRemove)}
            removeLabel={`Remove ${family}`}
          />
        </div>
      ) : (
        <div className="nx-vars-editor__actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nx-vars-editor__button nx-vars-editor__remove"
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      )}
    </>
  );
}

/** A font variable's plain name. */
function labelOf(row: FontTokenRow): string {
  // The name Variables shows for it, never the code name.
  return tokenDisplayLabel(row.token);
}

/** The site's font variables, each with a note when its first font has no file. */
function FontVariables({
  rows,
  faces,
  onOpenTokens,
}: {
  rows: readonly FontTokenRow[];
  faces: readonly FontFaceDef[];
  onOpenTokens: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <section className="nx-vars__group" aria-labelledby="nx-fonts-variables">
      <div className="nx-vars__group-head">
        <h3 className="nx-vars__group-name" id="nx-fonts-variables">
          {`Font ${words().variables}`}
        </h3>
      </div>
      {rows.length === 0 ? (
        <p className="nx-vars__empty">
          {`No font ${words().variables} yet. ${EDITOR_WORDS.variables} creates them.`}
        </p>
      ) : (
        <ul className="nx-vars__list">
          {rows.map(row => (
            <VariableRow
              key={row.token.id ?? row.token.name}
              row={row}
              faces={faces}
              onOpenTokens={onOpenTokens}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One font variable: drawn in its whole stack, with its first family named. */
function VariableRow({
  row,
  onOpenTokens,
}: {
  row: FontTokenRow;
  faces: readonly FontFaceDef[];
  onOpenTokens: (() => void) | undefined;
}): React.JSX.Element {
  const label = labelOf(row);
  const first = row.reading.firstChoice?.family ?? row.token.values.light;
  const notes = tokenNotes(row);
  const named = row.darkReading !== undefined;
  const content = (
    <>
      {/* The whole stack, so what is drawn is what the page draws. */}
      <span
        className="nx-vars__specimen nx-fonts__lead"
        aria-hidden="true"
        style={{ fontFamily: row.token.values.light }}
      >
        Aa
      </span>
      <span className="nx-vars__name" title={label}>
        {label}
      </span>
      <span className="nx-vars__chip" aria-hidden="true">
        {first}
      </span>
    </>
  );
  return (
    <li>
      {onOpenTokens === undefined ? (
        <div className="nx-vars__row nx-fonts__static-row">{content}</div>
      ) : (
        <button
          type="button"
          className="nx-vars__row"
          aria-label={`${label}, ${row.token.values.light}`}
          onClick={onOpenTokens}
        >
          {content}
        </button>
      )}
      {notes.map(note => (
        <p className="nx-fonts__attention" key={note.mode}>
          {named ? `In ${note.mode} mode: ${note.text}` : note.text}
          {onOpenTokens === undefined ? null : (
            <>
              {" "}
              <button
                type="button"
                className="nx-vars__link"
                onClick={onOpenTokens}
              >
                Edit this variable
              </button>
            </>
          )}
        </p>
      ))}
    </li>
  );
}
