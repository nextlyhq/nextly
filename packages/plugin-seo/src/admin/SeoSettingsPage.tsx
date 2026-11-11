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
  SEO_SETTINGS_SLUG,
  SETUP_STEPS,
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
  const settings = useSingleDocument(SEO_SETTINGS_SLUG);
  const types = usePluginRoute<ContentTypesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: CONTENT_TYPES_ROUTE_PATH,
    // A type's newest page and address change elsewhere in the admin.
    staleTime: 0,
  });

  let body: JSX.Element;
  if (settings.error) {
    body = (
      <p className="nx-seo-alert" role="alert">
        The SEO settings could not be read. {apiErrorMessage(settings.error)}
      </p>
    );
  } else if (settings.data === undefined || types.pending) {
    body = (
      <p className="nx-seo-state" role="status">
        Loading the SEO settings…
      </p>
    );
  } else {
    body = (
      <SettingsScreen
        stored={settings.data}
        types={types.data?.items ?? []}
        typesFailed={types.error !== null}
        reread={async () => (await settings.refetch()).data}
      />
    );
  }
  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      {body}
    </div>
  );
}

/** The screen once the settings are read. */
function SettingsScreen({
  stored: initial,
  types,
  typesFailed,
  reread,
}: {
  stored: StoredSettings;
  types: readonly SeoContentType[];
  typesFailed: boolean;
  reread: () => Promise<StoredSettings | undefined>;
}): JSX.Element {
  const update = useUpdateSingleDocument(SEO_SETTINGS_SLUG);
  // The settings as last read or saved, which the draft is compared with.
  const [stored, setStored] = useState(initial);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(initial));
  const [tab, setTab] = useState<TabId>(tabInAddress);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const finished = draft.setupStep >= SETUP_STEPS;
  const [setupOpen, setSetupOpen] = useState(
    () => !finished && !draftOf(initial).setupDismissed
  );
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const changes = changesOf(stored, draft);
  const problem = draftProblem(draft, types);
  const notPublic = types.filter(type => !type.public).length;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (changes === null) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

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
          setDraft(draftOf(fresh));
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

  const choose = (next: TabId) => {
    setTab(next);
    showTabInAddress(next);
  };
  const current = TABS.find(each => each.id === tab) ?? TABS[1];
  const tabProps = {
    draft,
    change: (next: (d: SettingsDraft) => SettingsDraft) => setDraft(next),
  };

  return (
    <>
      {!finished && !setupOpen ? (
        <div className="nx-seo-banner" role="status">
          <span>
            <b>Finish setting up SEO.</b>{" "}
            {Math.min(draft.setupStep, SETUP_STEPS)} of {SETUP_STEPS} steps
            done. Your answers so far are saved.
          </span>
          <Button type="button" size="sm" onClick={() => setSetupOpen(true)}>
            Finish setup
          </Button>
        </div>
      ) : null}
      <header className="nx-seo-head">
        <div>
          <h1>SEO settings</h1>
          <p>Rules for the whole site. A page&apos;s own values always win.</p>
        </div>
        <div className="nx-seo-acts">
          {changes !== null && problem !== null ? (
            <span className="nx-seo-help">{problem}</span>
          ) : null}
          <Button
            type="button"
            disabled={changes === null || problem !== null || saving}
            onClick={() => {
              void save(draft).then(saved => {
                if (!saved) return;
                setEditing(null);
                toastMutationResult("SEO settings saved", undefined);
              });
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>
      {failure === null ? null : (
        <p className="nx-seo-alert" role="alert">
          Not saved. {failure}
        </p>
      )}
      <div className="nx-seo-tabs" role="tablist" aria-label="SEO settings">
        {TABS.map((each, index) => (
          <button
            key={each.id}
            ref={element => {
              tabRefs.current[each.id] = element;
            }}
            type="button"
            role="tab"
            id={`nx-seo-tab-${each.id}`}
            className="nx-seo-tab"
            aria-selected={tab === each.id}
            aria-controls="nx-seo-panel"
            tabIndex={tab === each.id ? 0 : -1}
            onClick={() => choose(each.id)}
            onKeyDown={event => {
              const step =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (step === 0) return;
              const next = TABS[(index + step + TABS.length) % TABS.length].id;
              choose(next);
              tabRefs.current[next]?.focus();
            }}
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
      <section
        className="nx-seo-body"
        role="tabpanel"
        id="nx-seo-panel"
        aria-labelledby={`nx-seo-tab-${current.id}`}
      >
        <p className="nx-seo-lead">{current.lead}</p>
        {tab === "general" ? <GeneralTab {...tabProps} /> : null}
        {tab === "types" ? (
          typesFailed ? (
            <p className="nx-seo-alert" role="alert">
              The content types could not be read. Reload the page to try again.
            </p>
          ) : (
            <ContentTypesTab
              {...tabProps}
              types={types}
              editing={editing}
              setEditing={setEditing}
            />
          )
        ) : null}
        {tab === "brand" ? <BrandTab {...tabProps} /> : null}
        {tab === "crawlers" ? <CrawlersTab {...tabProps} /> : null}
      </section>
      {setupOpen ? (
        <SetupDialog
          open
          firstStep={
            finished
              ? 1
              : (Math.min(draft.setupStep + 1, SETUP_STEPS) as 1 | 2 | 3)
          }
          draft={draft}
          change={tabProps.change}
          types={types}
          save={save}
          close={landOn => {
            setSetupOpen(false);
            if (landOn !== undefined) choose(landOn);
          }}
        />
      ) : null}
    </>
  );
}
