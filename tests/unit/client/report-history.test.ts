// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {MatchView} from "../../../src/ui/views/site/match.js";
import {TableView} from "../../../src/ui/views/site/table.js";
import {makeStatement} from "../helpers.js";
import {siteFor} from "../ui/helpers.js";
import {runScript} from "./run-script.js";

const ALTMAN = makeStatement();
const MUSK = makeStatement({id: "musk-2026-09-01-x", ceo: "musk", date: "2026-09-01"});
const STATEMENTS = [ALTMAN, MUSK];

type Listener = [EventTarget, string, EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?];
let added: Listener[] = [];

function track(target: EventTarget) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
        added.push([target, type, listener!, options]);
        add(type, listener, options);
    });
}

beforeEach(() => {
    track(document);
    track(window);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        setTimeout(() => this.dispatchEvent(new Event("close")));
    };
    vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: vi.fn()}));
});

afterEach(() => {
    for (const [target, type, listener, options] of added) target.removeEventListener(type, listener, options);
    added = [];
    vi.restoreAllMocks();
    document.documentElement.innerHTML = "";
    vi.unstubAllGlobals();
});

async function start(page: "table" | "match" = "table") {
    const site = await siteFor(STATEMENTS);
    const pages = new Map(
        STATEMENTS.map((st) => [
            `/match/${st.id}`,
            MatchView({site, title: "t", statement: site.league.byId.get(st.id)!}),
        ])
    );
    vi.stubGlobal(
        "fetch",
        vi.fn(async (path: string) => ({ok: true, text: async () => pages.get(path)}))
    );
    const html = page === "table" ? TableView({site, title: "t"}) : pages.get(`/match/${ALTMAN.id}`)!;
    history.replaceState(null, "", page === "table" ? "/" : `/match/${ALTMAN.id}`);
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
    runScript("report.js");
}

const dialog = () => document.getElementById("report") as HTMLDialogElement;
const shown = () => (dialog().open ? dialog().dataset.current : null);
const popped = () => new Promise((resolve) => window.addEventListener("popstate", resolve, {once: true}));

async function openFromTicker(id: string) {
    document.querySelector<HTMLAnchorElement>(`#ticker-list a[data-report="${id}"]`)!.click();
    await vi.waitFor(() => expect(shown()).toBe(id));
}

async function back() {
    const done = popped();
    history.back();
    await done;
}

describe("the report dialog and the browser's history", () => {
    it("adds an entry when it opens, and Back closes it on the list view's address", async () => {
        await start();
        const before = history.length;

        await openFromTicker(ALTMAN.id);
        expect(history.length).toBe(before + 1);
        expect(location.pathname).toBe(`/match/${ALTMAN.id}`);

        await back();
        expect(shown()).toBeNull();
        expect(location.pathname).toBe("/");
    });

    it("goes back when closed by its button, adding no entry, and Forward opens it again", async () => {
        await start();
        await openFromTicker(ALTMAN.id);
        const length = history.length;

        const done = popped();
        document.querySelector<HTMLButtonElement>("#report [data-close]")!.click();
        await done;
        expect(shown()).toBeNull();
        expect(location.pathname).toBe("/");
        expect(history.length).toBe(length);

        history.forward();
        await vi.waitFor(() => expect(shown()).toBe(ALTMAN.id));
        expect(location.pathname).toBe(`/match/${ALTMAN.id}`);
    });

    it("goes back when closed by Escape", async () => {
        await start();
        await openFromTicker(ALTMAN.id);

        const done = popped();
        dialog().dispatchEvent(new Event("cancel", {cancelable: true}));
        dialog().close();
        await done;
        expect(location.pathname).toBe("/");
    });

    it("replaces its entry when stepping to the next match, so one Back still closes it", async () => {
        await start();
        await openFromTicker(MUSK.id);
        const length = history.length;
        const next = shown() === MUSK.id ? ALTMAN.id : MUSK.id;

        document.querySelector<HTMLButtonElement>("#report [data-next]")!.click();
        await vi.waitFor(() => expect(shown()).toBe(next));
        expect(history.length).toBe(length);
        expect(location.pathname).toBe(`/match/${next}`);

        await back();
        expect(shown()).toBeNull();
        expect(location.pathname).toBe("/");
    });

    it("returns to a match page loaded directly when the dialog over it closes", async () => {
        await start("match");
        await openFromTicker(MUSK.id);

        const done = popped();
        document.querySelector<HTMLButtonElement>("#report [data-close]")!.click();
        await done;
        expect(shown()).toBeNull();
        expect(location.pathname).toBe(`/match/${ALTMAN.id}`);
    });

    it("leaves alone the entries an earlier page load made", async () => {
        history.replaceState({report: MUSK.id, doc: "earlier"}, "", "/");
        await start();
        history.replaceState({report: MUSK.id, doc: "earlier"}, "", "/");
        history.pushState({report: ALTMAN.id, doc: "earlier"}, "", `/match/${ALTMAN.id}`);

        await back();
        history.forward();
        await popped();
        expect(shown()).toBeNull();
        expect(fetch).not.toHaveBeenCalled();

        const before = history.length;
        await openFromTicker(MUSK.id);
        expect(history.length).toBe(before + 1);
        expect(history.state).toMatchObject({report: MUSK.id});
        expect(history.state.doc).not.toBe("earlier");
    });

    it("keeps one entry when reopened before the browser has finished going back", async () => {
        await start();
        const before = history.length;
        await openFromTicker(ALTMAN.id);

        const closed = new Promise((resolve) => dialog().addEventListener("close", resolve, {once: true}));
        document.querySelector<HTMLButtonElement>("#report [data-close]")!.click();
        await closed;
        await openFromTicker(MUSK.id);
        expect(location.pathname).toBe(`/match/${MUSK.id}`);
        expect(history.length).toBe(before + 1);

        await back();
        expect(shown()).toBeNull();
        expect(location.pathname).toBe("/");
    });
});
