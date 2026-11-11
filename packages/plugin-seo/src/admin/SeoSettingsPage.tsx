/**
 * The SEO settings screen: rules for the whole site, under four tabs, saved
 * together; and, the first time it opens, the three-step setup over it.
 *
 * @module admin/SeoSettingsPage
 */
import {
  apiErrorMessage,
  Button,
  toastMutationResult,
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
} from "@nextlyhq/plugin-sdk/admin";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  CONTENT_TYPES_ROUTE_PATH,
  SEO_PLUGIN_NAME,
  SETTINGS_DOCUMENT_ROUTE_PATH,
  SETUP_STEPS,
  type SettingsDocumentBody,
  type SeoContentType,
} from "../settings/contract";

import {
  changesOf,
  draftOf,
  type SettingsDraft,
  type StoredSettings,
} from "./settings-draft";
import { SetupDialog } from "./SetupDialog";
import { ROOT, SeoStyles } from "./styles";
import {
  BrandTab,
  ContentTypesTab,
  CrawlersTab,
  draftProblem,
  GeneralTab,
  isTabId,
  TABS,
  type TabId,
  type TabProps,
} from "./tabs";

/** The tab the screen opens on: the one people use most. */
const FIRST_TAB: TabId = "types";

/** The tab the address names, so a link can land on the right one. */
function tabInAddress(): TabId {
  if (typeof window === "undefined") return FIRST_TAB;
  const named = new URLSearchParams(window.location.search).get("tab");
  return isTabId(named) ? named : FIRST_TAB;
}

/** Keeps the open tab in the address without adding to the history. */
function showTabInAddress(tab: TabId): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

/** The list the content types route answers with. */
interface ContentTypesBody {
  items: SeoContentType[];
}

/** The SEO settings screen, as the admin mounts it. */
export function SeoSettingsPage(): JSX.Element {
  // The Single as the host registered it: a host may rename it.
  const where = usePluginRoute<SettingsDocumentBody>({
    plugin: SEO_PLUGIN_NAME,
    path: SETTINGS_DOCUMENT_ROUTE_PATH,
  });
  const slug = where.data?.single;
  const settings = useSingleDocument(slug, {
    queryOptions: { enabled: slug !== undefined },
  });
  const types = usePluginRoute<ContentTypesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CONTENT_TYPES_ROUTE_PATH,
    // A type's newest page and address change elsewhere in the admin.
    staleTime: 0,
  });

  const failed = where.error ?? settings.error;
  let body: JSX.Element;
  if (settings.data !== undefined && slug !== undefined && !types.pending) {
    // Once read, the form stays: a later read that fails is said above it,
    // never by replacing it and the edits it holds.
    body = (
      <>
        {failed ? (
          <p className="nx-seo-alert" role="alert">
            The SEO settings could not be read again. What is on screen is kept.{" "}
            {apiErrorMessage(failed)}
          </p>
        ) : null}
        <SettingsScreen
          slug={slug}
          stored={settings.data}
          types={types.data?.items ?? []}
          typesFailed={types.error !== null}
          reread={async () => (await settings.refetch()).data}
        />
      </>
    );
  } else if (failed) {
    body = (
      <p className="nx-seo-alert" role="alert">
        The SEO settings could not be read. {apiErrorMessage(failed)}
      </p>
    );
  } else {
    body = (
      <p className="nx-seo-state" role="status">
        Loading the SEO settings…
      </p>
    );
  }
  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      {body}
    </div>
  );
}

/** The draft, the settings it is compared with, and how a save goes. */
function useSettingsSave(
  slug: string,
  initial: StoredSettings,
  reread: () => Promise<StoredSettings | undefined>
) {
  const update = useUpdateSingleDocument(slug);
  // The settings as last read or saved, which the draft is compared with.
  const [stored, setStored] = useState(initial);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(initial));
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Saves `next`, and reports whether it was stored. */
  const save = useCallback(
    async (next: SettingsDraft): Promise<boolean> => {
      const sent = changesOf(stored, next);
      setDraft(next);
      if (sent === null) return true;
      setSaving(true);
      setFailure(null);
      try {
        await update.mutateAsync(sent);
        const fresh = await reread();
        if (fresh !== undefined) {
          setStored(fresh);
          // Edits made while the save was on its way are kept: only a draft
          // nobody touched since is replaced by what was stored.
          setDraft(current => (current === next ? draftOf(fresh) : current));
        }
        return true;
      } catch (error) {
        setFailure(
          error instanceof Error ? apiErrorMessage(error) : String(error)
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [stored, update, reread]
  );

  return { stored, draft, setDraft, save, saving, failure };
}

/** Leaving the page with unsaved changes asks first. */
function useLeaveWarning(unsaved: boolean): void {
  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
}

/** The line that offers setup again until it is finished. */
function SetupBanner({
  stepsDone,
  reopen,
}: {
  stepsDone: number;
  reopen: () => void;
}): JSX.Element {
  return (
    <div className="nx-seo-banner" role="status">
      <span>
        <b>Finish setting up SEO.</b> {Math.min(stepsDone, SETUP_STEPS)} of{" "}
        {SETUP_STEPS} steps done. Your answers so far are saved.
      </span>
      <Button type="button" size="sm" onClick={reopen}>
        Finish setup
      </Button>
    </div>
  );
}

/** The tab list, its arrow keys moving between tabs. */
function SettingsTabList({
  tab,
  choose,
  notPublic,
}: {
  tab: TabId;
  choose: (tab: TabId) => void;
  notPublic: number;
}): JSX.Element {
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const move = (index: number, key: string) => {
    const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = TABS[(index + step + TABS.length) % TABS.length].id;
    choose(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="nx-seo-tabs" role="tablist" aria-label="SEO settings">
      {TABS.map((each, index) => (
        <button
          key={each.id}
          ref={element => {
            refs.current[each.id] = element;
          }}
          type="button"
          role="tab"
          id={`nx-seo-tab-${each.id}`}
          className="nx-seo-tab"
          aria-selected={tab === each.id}
          aria-controls="nx-seo-panel"
          tabIndex={tab === each.id ? 0 : -1}
          onClick={() => choose(each.id)}
          onKeyDown={event => move(index, event.key)}
        >
          {each.label}
          {each.id === "types" && notPublic > 0 ? (
            <span
              className="nx-seo-cnt"
              title={`${notPublic} content type${notPublic === 1 ? " has" : "s have"} no public address`}
            >
              {notPublic}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The open tab's content. */
function SettingsPanel({
  tab,
  tabProps,
  types,
  typesFailed,
  editing,
  setEditing,
}: {
  tab: TabId;
  tabProps: TabProps;
  types: readonly SeoContentType[];
  typesFailed: boolean;
  editing: string | null;
  setEditing: (key: string | null) => void;
}): JSX.Element {
  const current = TABS.find(each => each.id === tab) ?? TABS[1];
  let content: JSX.Element;
  if (tab === "general") content = <GeneralTab {...tabProps} />;
  else if (tab === "brand") content = <BrandTab {...tabProps} />;
  else if (tab === "crawlers") content = <CrawlersTab {...tabProps} />;
  else if (typesFailed) {
    content = (
      <p className="nx-seo-alert" role="alert">
        The content types could not be read. Reload the page to try again.
      </p>
    );
  } else {
    content = (
      <ContentTypesTab
        {...tabProps}
        types={types}
        editing={editing}
        setEditing={setEditing}
      />
    );
  }
  return (
    <section
      className="nx-seo-body"
      role="tabpanel"
      id="nx-seo-panel"
      aria-labelledby={`nx-seo-tab-${current.id}`}
    >
      <p className="nx-seo-lead">{current.lead}</p>
      {content}
    </section>
  );
}

/** The heading, and the one button that saves every tab. */
function SettingsHeader({
  unsavedProblem,
  canSave,
  saving,
  save,
}: {
  /** What stops unsaved changes being saved, if anything does. */
  unsavedProblem: string | null;
  canSave: boolean;
  saving: boolean;
  save: () => void;
}): JSX.Element {
  return (
    <header className="nx-seo-head">
      <div>
        <h1>SEO settings</h1>
        <p>Rules for the whole site. A page&apos;s own values always win.</p>
      </div>
      <div className="nx-seo-acts">
        {unsavedProblem === null ? null : (
          <span className="nx-seo-help">{unsavedProblem}</span>
        )}
        <Button type="button" disabled={!canSave} onClick={save}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </header>
  );
}

/** The step setup opens on: the first not yet answered, else the first. */
function firstSetupStep(stepsDone: number): 1 | 2 | 3 {
  return stepsDone >= SETUP_STEPS
    ? 1
    : (Math.min(stepsDone + 1, SETUP_STEPS) as 1 | 2 | 3);
}

/** The screen once the settings are read. */
function SettingsScreen({
  slug,
  stored: initial,
  types,
  typesFailed,
  reread,
}: {
  slug: string;
  stored: StoredSettings;
  types: readonly SeoContentType[];
  typesFailed: boolean;
  reread: () => Promise<StoredSettings | undefined>;
}): JSX.Element {
  const { stored, draft, setDraft, save, saving, failure } = useSettingsSave(
    slug,
    initial,
    reread
  );
  const [tab, setTab] = useState<TabId>(tabInAddress);
  const [editing, setEditing] = useState<string | null>(null);
  const finished = draft.setupStep >= SETUP_STEPS;
  const [setupOpen, setSetupOpen] = useState(
    () => !finished && !draftOf(initial).setupDismissed
  );
  const changes = changesOf(stored, draft);
  const problem = draftProblem(draft, types);
  useLeaveWarning(changes !== null);

  const choose = (next: TabId) => {
    setTab(next);
    showTabInAddress(next);
  };
  const tabProps: TabProps = { draft, change: next => setDraft(next) };
  const saveChanges = () => {
    void save(draft).then(saved => {
      if (!saved) return;
      setEditing(null);
      toastMutationResult("SEO settings saved", undefined);
    });
  };

  return (
    <>
      {!finished && !setupOpen ? (
        <SetupBanner
          stepsDone={draft.setupStep}
          reopen={() => setSetupOpen(true)}
        />
      ) : null}
      <SettingsHeader
        unsavedProblem={changes !== null ? problem : null}
        canSave={changes !== null && problem === null && !saving}
        saving={saving}
        save={saveChanges}
      />
      {failure === null ? null : (
        <p className="nx-seo-alert" role="alert">
          Not saved. {failure}
        </p>
      )}
      <SettingsTabList
        tab={tab}
        choose={choose}
        notPublic={types.filter(type => !type.public).length}
      />
      <SettingsPanel
        tab={tab}
        tabProps={tabProps}
        types={types}
        typesFailed={typesFailed}
        editing={editing}
        setEditing={setEditing}
      />
      {setupOpen ? (
        <SetupDialog
          open
          firstStep={firstSetupStep(draft.setupStep)}
          draft={draft}
          change={tabProps.change}
          types={types}
          save={save}
          failure={failure}
          close={landOn => {
            setSetupOpen(false);
            if (landOn !== undefined) choose(landOn);
          }}
        />
      ) : null}
    </>
  );
}
