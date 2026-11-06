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

// report.js listens on the document, which outlives each test, so its listeners are taken off after
let added: Parameters<Document["addEventListener"]>[] = [];

beforeEach(() => {
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((...args: Parameters<Document["addEventListener"]>) => {
        added.push(args);
        add(...args);
    });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
    };
    vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: vi.fn()}));
});

afterEach(() => {
    for (const args of added) document.removeEventListener(...args);
    added = [];
    vi.restoreAllMocks();
    document.documentElement.innerHTML = "";
    vi.unstubAllGlobals();
});

async function openOver(pageSeason: string | undefined, matchSeason: string) {
    const page = await siteFor(STATEMENTS, pageSeason);
    const match = await siteFor(STATEMENTS, matchSeason, {view: "match", id: ALTMAN.id});
    const matchHtml = MatchView({site: match, title: "t", statement: match.league.byId.get(ALTMAN.id)!});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, text: async () => matchHtml}));
    document.documentElement.innerHTML = TableView({site: page, title: "t"}).replace(/^<!doctype html>/i, "");
    runScript("report.js");
    document.querySelector<HTMLAnchorElement>(`#ticker-list a[data-report="${ALTMAN.id}"]`)!.click();
    await vi.waitFor(() => expect(document.querySelector("#report-body .scoreboard")).not.toBeNull());
    return {
        lifted: matchHtml,
        crest: document.querySelector("#report-body .sb-team.home .crest")!,
        face: document.querySelector("#report-body .rp-speaker .face-crest")!,
        club: document.querySelector("#report-body .sb-team.home")!,
    };
}

describe("the report dialog follows the season of the page underneath", () => {
    it("takes the gold ring off a contender who leads only the statement's own season", async () => {
        const {lifted, crest, face, club} = await openOver("26-27", "25-26");

        expect(lifted).toContain("crest lg gold");
        expect(crest.classList.contains("gold")).toBe(false);
        expect(face.classList.contains("gold")).toBe(false);
        expect(club.getAttribute("href")).toBe("/26-27/club/altman");
    });

    it("links the club without a prefix over the all-time page", async () => {
        const {club} = await openOver(undefined, "25-26");

        expect(club.getAttribute("href")).toBe("/club/altman");
    });

    it("rings a contender gold who leads the page's season", async () => {
        const {lifted, crest, face, club} = await openOver("25-26", "26-27");

        expect(lifted).not.toContain("crest lg gold");
        expect(crest.classList.contains("gold")).toBe(true);
        expect(face.classList.contains("gold")).toBe(true);
        expect(club.getAttribute("href")).toBe("/25-26/club/altman");
    });
});

describe("the headline in the dialog", () => {
    it("is an h2 under the page's own h1, and still names the dialog", async () => {
        const {lifted} = await openOver(undefined, "25-26");
        const dialog = document.getElementById("report")!;
        const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;

        expect(lifted).toContain(`<h1 class="rp-headline" id="report-headline">`);
        expect(heading.tagName).toBe("H2");
        expect(heading.classList.contains("rp-headline")).toBe(true);
        expect(heading.querySelector("a")!.textContent).toBe(ALTMAN.headline.text);
        expect(document.querySelectorAll("h1")).toHaveLength(1);
        expect(dialog.querySelector("h1")).toBeNull();
    });
});
