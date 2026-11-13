/**
 * The Connections tab's second card, "Prove you own the site": a box for
 * each service's verification code, and any other service as a name and a
 * code. Pasting a whole tag or a DNS record keeps only its code and says so;
 * another service's tag offers to move it to that service's box; markup, a
 * file name or a half tag is refused with the reason, and the save waits.
 *
 * Once saved, each code is looked for on the live home page by the same
 * fetch Inspect uses, and the box says whether it is there yet.
 *
 * @module admin/verification
 */
import {
  Button,
  Input,
  SettingsRowGroup,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { Check, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import { SEO_PLUGIN_NAME } from "../settings/contract";
import {
  MAX_OTHER_SERVICES,
  readOtherName,
  readPasted,
  serviceOf,
  VERIFICATION_CHECK_ROUTE_PATH,
  VERIFICATION_SERVICES,
  type VerificationCheckBody,
  type VerificationServiceKey,
} from "../settings/verification";

import type { OtherTagDraft, VerificationDraft } from "./settings-draft";
import { ControlNote, SettingsCard } from "./settings-parts";
import type { TabProps } from "./tabs";

const PLACEHOLDER = "Code, or the whole <meta> tag";

/** Where each service's own Verify button is, for the line after a find. */
const VERIFY_AT: Record<VerificationServiceKey, string> = {
  google: "Google Search Console",
  bing: "Bing Webmaster Tools",
  pinterest: "Pinterest",
  yandex: "Yandex Webmaster",
  baidu: "Baidu Search Resource Platform",
};

/** What the screen said it did with a paste, until the box is edited again. */
const TOOK_FROM = {
  tag: "Took the code from the tag you pasted.",
  dns: "That was the DNS form. Took the code after the = sign.",
} as const;

/** Why the verification codes cannot be saved yet, in a sentence; null when they can. */
export function verificationDraftProblem(
  draft: VerificationDraft
): string | null {
  for (const service of VERIFICATION_SERVICES) {
    const read = readPasted(draft[service.key], service.key);
    if (read.kind !== "empty" && read.kind !== "code") {
      return `Fix the ${service.name} code first.`;
    }
  }
  if (filledOthers(draft.others).length > MAX_OTHER_SERVICES) {
    return `Keep other services to ${MAX_OTHER_SERVICES} tags.`;
  }
  return draft.others.some(
    (_, index) => otherRowProblem(draft.others, index) !== null
  )
    ? "Fix the other services' tags first."
    : null;
}

/** The rows under Other services that hold anything. */
function filledOthers(others: readonly OtherTagDraft[]): OtherTagDraft[] {
  return others.filter(tag => tag.name.trim() !== "" || tag.code.trim() !== "");
}

/** Why one row under Other services cannot be saved; null when it can. */
function otherRowProblem(
  others: readonly OtherTagDraft[],
  index: number
): ReactNode | null {
  const tag = others[index];
  if (tag === undefined) return null;
  const name = tag.name.trim();
  const code = tag.code.trim();
  if (name === "" && code === "") return null;
  if (name === "" || code === "") return "A tag needs a name and a code.";
  const named = readOtherName(name);
  if (named?.kind === "refused") return named.message;
  if (named?.kind === "elsewhere") {
    return `That's ${serviceOf(named.service).name}'s tag.`;
  }
  const read = readPasted(code);
  if (read.kind === "refused") return read.message;
  if (read.kind !== "code") return "Only a code can go in this box.";
  const earlier = others
    .slice(0, index)
    .some(other => other.name.trim().toLowerCase() === name.toLowerCase());
  return earlier ? "That name is already used above." : null;
}

/** The live check's state, as the card shows it. */
type LiveState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "failed" }
  | { state: "done"; body: VerificationCheckBody };

/** The time of day a check was made, as `14:02`. */
function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** The host of a production address, for a sentence. */
function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** A link-styled button inside a line under a box. */
function InlineAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="font-medium text-foreground underline underline-offset-2 hover:decoration-2"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * What the live home page says about a saved tag: found, not there yet, or
 * not read; nothing while unsaved or where no check has answered.
 */
function LiveLine({
  name,
  verifyAt,
  live,
  recheck,
}: {
  name: string;
  verifyAt: string;
  live: LiveState;
  recheck: () => void;
}): JSX.Element | null {
  if (live.state === "checking") {
    return <ControlNote>Looking for it on the live home page…</ControlNote>;
  }
  if (live.state === "failed") {
    return (
      <ControlNote tone="warning">
        Couldn&apos;t check the live home page.{" "}
        <InlineAction onClick={recheck}>Check again</InlineAction>
      </ControlNote>
    );
  }
  if (live.state !== "done") return null;
  const { body } = live;
  const tag = body.tags.find(each => each.name === name.toLowerCase());
  if (tag === undefined || body.homePages.length === 0) return null;
  const unread = body.homePages.filter(page => !page.read);
  const missing = body.homePages.filter(
    page => page.read && !tag.foundAt.includes(page.address)
  );
  if (unread.length === 0 && missing.length === 0) {
    return (
      <p
        role="status"
        className="mt-1.5 flex items-start gap-1 text-xs font-medium leading-normal text-success-text"
      >
        <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Found on the live home page at {timeOf(body.checkedAt)}. Now press
          Verify in {verifyAt}.
        </span>
      </p>
    );
  }
  const where =
    body.homePages.length > 1
      ? ` of ${[...missing, ...unread].map(page => hostOf(page.address)).join(", ")}`
      : "";
  return (
    <ControlNote tone="warning">
      {missing.length > 0
        ? `Not on the live home page${where} yet. If pages are cached, it shows after the next deploy or cache refresh. `
        : `Couldn't read the live home page${where}: ${unread[0]?.message ?? ""} `}
      <InlineAction onClick={recheck}>Check again</InlineAction>
    </ControlNote>
  );
}

/** A green line saying what the screen did with a paste. */
function TookNote({ id, text }: { id: string; text: string }): JSX.Element {
  return (
    <p
      id={id}
      role="status"
      className="mt-1.5 flex items-start gap-1 text-xs font-medium leading-normal text-success-text"
    >
      <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

/** What one box under a service shows beneath it, from what it holds. */
function ServiceBoxNote({
  id,
  keyOf,
  text,
  took,
  othersFull,
  move,
  live,
}: {
  id: string;
  keyOf: VerificationServiceKey;
  text: string;
  took: string | undefined;
  /** Other services holds as many tags as it may, so none can move there. */
  othersFull: boolean;
  move: (target: VerificationServiceKey | "others") => void;
  live: ReactNode;
}): JSX.Element | null {
  const read = readPasted(text, keyOf);
  if (read.kind === "refused") {
    return (
      <ControlNote id={id} tone="danger">
        {read.message}
      </ControlNote>
    );
  }
  if (read.kind === "other" && othersFull) {
    return (
      <ControlNote id={id} tone="danger">
        That&apos;s the {read.name} tag, which has no box of its own. Other
        services already holds {MAX_OTHER_SERVICES} tags: remove one there
        first.
      </ControlNote>
    );
  }
  if (read.kind === "elsewhere" || read.kind === "other") {
    const target =
      read.kind === "elsewhere"
        ? serviceOf(read.service).name
        : "Other services";
    return (
      <div id={id} className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-danger-text">
          {read.kind === "elsewhere"
            ? `That's ${target}'s tag.`
            : `That's the ${read.name} tag, which has no box of its own.`}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            move(read.kind === "elsewhere" ? read.service : "others")
          }
        >
          Move it to {target}
        </Button>
      </div>
    );
  }
  if (took !== undefined) return <TookNote id={id} text={took} />;
  return <>{live}</>;
}

/** The card's state: the live check, and what each paste was turned into. */
function useLiveCheck(saved: VerificationDraft): {
  live: LiveState;
  recheck: () => void;
} {
  const [live, setLive] = useState<LiveState>({ state: "idle" });
  const asking = useRef<AbortController | null>(null);
  const savedKey = JSON.stringify(saved);
  const hasSaved =
    VERIFICATION_SERVICES.some(service => saved[service.key].trim() !== "") ||
    saved.others.some(tag => tag.code.trim() !== "");
  const recheck = useCallback(() => {
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    setLive({ state: "checking" });
    writePluginRoute<VerificationCheckBody>({
      plugin: SEO_PLUGIN_NAME,
      path: VERIFICATION_CHECK_ROUTE_PATH,
      body: {},
      signal: controller.signal,
    }).then(
      body => {
        if (controller.signal.aborted) return;
        setLive(
          body === undefined ? { state: "failed" } : { state: "done", body }
        );
      },
      () => {
        if (!controller.signal.aborted) setLive({ state: "failed" });
      }
    );
  }, []);
  // Checked when the card opens with codes saved, and again after each save
  // that changes them; never for codes not saved yet.
  useEffect(() => {
    if (hasSaved) recheck();
    else setLive({ state: "idle" });
    return () => asking.current?.abort();
  }, [savedKey, hasSaved, recheck]);
  return { live, recheck };
}

/** A box under a service: its code, and what was made of the paste. */
function ServiceRow({
  serviceKey,
  draft,
  saved,
  set,
  move,
  live,
  recheck,
}: {
  serviceKey: VerificationServiceKey;
  draft: VerificationDraft;
  saved: VerificationDraft;
  set: (key: VerificationServiceKey, text: string) => string | undefined;
  move: (
    from: VerificationServiceKey,
    to: VerificationServiceKey | "others"
  ) => void;
  live: LiveState;
  recheck: () => void;
}): JSX.Element {
  const service = serviceOf(serviceKey);
  const noteId = useId();
  const [took, setTook] = useState<string | undefined>(undefined);
  const text = draft[serviceKey];
  const read = readPasted(text, serviceKey);
  const savedHere =
    text.trim() !== "" && text.trim() === saved[serviceKey].trim();
  return (
    <SettingsRowGroup
      label={service.name}
      description={
        <code className="font-mono text-xs">{service.metaName}</code>
      }
    >
      <Input
        className="font-mono text-[13px] placeholder:font-sans"
        value={text}
        placeholder={PLACEHOLDER}
        aria-label={`${service.name} verification code`}
        aria-invalid={read.kind !== "empty" && read.kind !== "code"}
        aria-describedby={noteId}
        spellCheck={false}
        autoComplete="off"
        onChange={event => setTook(set(serviceKey, event.target.value))}
      />
      <ServiceBoxNote
        id={noteId}
        keyOf={serviceKey}
        text={text}
        // Once the code is saved, what the live home page says replaces the
        // note about the paste.
        took={savedHere ? undefined : took}
        othersFull={filledOthers(draft.others).length >= MAX_OTHER_SERVICES}
        move={to => {
          setTook(undefined);
          move(serviceKey, to);
        }}
        live={
          savedHere ? (
            <LiveLine
              name={service.metaName}
              verifyAt={VERIFY_AT[serviceKey]}
              live={live}
              recheck={recheck}
            />
          ) : serviceKey === "google" && text.trim() === "" ? (
            <ControlNote id={noteId}>
              Not needed for the Search Console connection. Only if Google asks
              you for an HTML tag.
            </ControlNote>
          ) : null
        }
      />
    </SettingsRowGroup>
  );
}

/**
 * The row a whole tag pasted under Other services fills: its name and code,
 * a box's own tag included, so the row then offers to move it there.
 */
function pastedRow(text: string): OtherTagDraft | undefined {
  const read = readPasted(text);
  if (read.kind === "other") return { name: read.name, code: read.code };
  if (read.kind === "elsewhere" && text.trim().startsWith("<")) {
    return { name: serviceOf(read.service).metaName, code: read.code };
  }
  return undefined;
}

/** The rows under Other services: a name and a code each, and room for more. */
function OtherServices({
  draft,
  saved,
  setOthers,
  moveOther,
  live,
  recheck,
}: {
  draft: VerificationDraft;
  saved: VerificationDraft;
  setOthers: (next: (others: OtherTagDraft[]) => OtherTagDraft[]) => void;
  moveOther: (index: number, to: VerificationServiceKey) => void;
  live: LiveState;
  recheck: () => void;
}): JSX.Element {
  const baseId = useId();
  const rows =
    draft.others.length === 0 ? [{ name: "", code: "" }] : draft.others;
  const setRow = (index: number, next: OtherTagDraft) =>
    setOthers(() => rows.map((row, at) => (at === index ? next : row)));
  return (
    <SettingsRowGroup
      label="Other services"
      description="Any other tag a service asks for: its name and its code."
    >
      <div className="grid gap-3">
        {rows.map((row, index) => {
          const problem = otherRowProblem(rows, index);
          const named = readOtherName(row.name);
          const noteId = `${baseId}-${index}`;
          const savedHere = saved.others.some(
            tag =>
              tag.name.trim() === row.name.trim() &&
              tag.code.trim() === row.code.trim() &&
              row.code.trim() !== ""
          );
          const label = row.name.trim() || "this tag";
          return (
            <div key={index}>
              <div className="flex items-center gap-2">
                <Input
                  className="w-2/5 font-mono text-[13px] placeholder:font-sans"
                  value={row.name}
                  placeholder="Name"
                  aria-label={`Other service ${index + 1}: name`}
                  aria-invalid={problem !== null && named !== null}
                  aria-describedby={problem === null ? undefined : noteId}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={event => {
                    // A whole tag pasted into the name box fills both.
                    setRow(
                      index,
                      pastedRow(event.target.value) ?? {
                        ...row,
                        name: event.target.value,
                      }
                    );
                  }}
                />
                <Input
                  className="flex-1 font-mono text-[13px] placeholder:font-sans"
                  value={row.code}
                  placeholder="Code"
                  aria-label={`Other service ${index + 1}: code`}
                  aria-invalid={problem !== null && named === null}
                  aria-describedby={problem === null ? undefined : noteId}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={event => {
                    // A whole tag pasted into the code box fills both.
                    const read = readPasted(event.target.value);
                    setRow(
                      index,
                      pastedRow(event.target.value) ??
                        (read.kind === "code" && read.from !== undefined
                          ? { ...row, code: read.code }
                          : { ...row, code: event.target.value })
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${label}`}
                  onClick={() =>
                    setOthers(() => rows.filter((_, at) => at !== index))
                  }
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
              {problem !== null ? (
                <div id={noteId} className="flex flex-wrap items-center gap-2">
                  <ControlNote tone="danger">{problem}</ControlNote>
                  {named?.kind === "elsewhere" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1.5"
                      onClick={() => moveOther(index, named.service)}
                    >
                      Move it to {serviceOf(named.service).name}
                    </Button>
                  ) : null}
                </div>
              ) : savedHere ? (
                <LiveLine
                  name={row.name.trim()}
                  verifyAt="the service's site"
                  live={live}
                  recheck={recheck}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {rows.length < MAX_OTHER_SERVICES ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3 w-fit"
          onClick={() => setOthers(() => [...rows, { name: "", code: "" }])}
        >
          Add a tag
        </Button>
      ) : null}
    </SettingsRowGroup>
  );
}

/**
 * The card: a heading and its sentence, the boxes, and where saved codes
 * go. `saved` is what is stored, which the live check looks for.
 */
export function VerificationCard({
  draft,
  change,
  saved,
  host,
}: TabProps & { saved: VerificationDraft; host: string }): JSX.Element {
  const codes = draft.verificationCodes;
  const { live, recheck } = useLiveCheck(saved);
  const headingId = useId();
  const setCodes = (next: (codes: VerificationDraft) => VerificationDraft) =>
    change(current => ({
      ...current,
      verificationCodes: next(current.verificationCodes),
    }));
  // A paste that is a whole tag or a DNS record keeps only its code; what
  // was done is said under the box.
  const set = (
    key: VerificationServiceKey,
    text: string
  ): string | undefined => {
    const read = readPasted(text, key);
    const kept =
      read.kind === "code" && read.from !== undefined ? read.code : text;
    setCodes(current => ({ ...current, [key]: kept }));
    return read.kind === "code" && read.from !== undefined
      ? TOOK_FROM[read.from]
      : undefined;
  };
  const move = (
    from: VerificationServiceKey,
    to: VerificationServiceKey | "others"
  ) =>
    setCodes(current => {
      const read = readPasted(current[from], from);
      if (read.kind === "elsewhere" && to !== "others") {
        return { ...current, [from]: "", [to]: read.code };
      }
      const others = filledOthers(current.others);
      if (
        read.kind === "other" &&
        to === "others" &&
        others.length < MAX_OTHER_SERVICES
      ) {
        return {
          ...current,
          [from]: "",
          others: [...others, { name: read.name, code: read.code }],
        };
      }
      return current;
    });
  const moveOther = (index: number, to: VerificationServiceKey) =>
    setCodes(current => {
      const tag = current.others[index];
      if (tag === undefined) return current;
      return {
        ...current,
        [to]: tag.code.trim(),
        others: current.others.filter((_, at) => at !== index),
      };
    });
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-sm font-semibold text-foreground">
        Prove you own the site
      </h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">
        Search engines and other services ask for a short code in your pages to
        show the site is yours. Paste the code or the whole tag they give you.
      </p>
      <SettingsCard>
        {VERIFICATION_SERVICES.map(service => (
          <ServiceRow
            key={service.key}
            serviceKey={service.key}
            draft={codes}
            saved={saved}
            set={set}
            move={move}
            live={live}
            recheck={recheck}
          />
        ))}
        <OtherServices
          draft={codes}
          saved={saved}
          setOthers={next =>
            setCodes(current => ({ ...current, others: next(current.others) }))
          }
          moveOther={moveOther}
          live={live}
          recheck={recheck}
        />
      </SettingsCard>
      <p className="mt-3 text-xs text-muted-foreground">
        Saved codes go into the head of your home page, {host}. Then press
        Verify on the service&apos;s site.
      </p>
    </section>
  );
}
