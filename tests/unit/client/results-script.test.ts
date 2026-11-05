// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {MatchView} from "../../../src/ui/views/site/match.js";
import {ResultsView, type ResultsFilters} from "../../../src/ui/views/site/results.js";
import {makeStatement} from "../helpers.js";
import {siteFor} from "../ui/helpers.js";
import {runScript} from "./run-script.js";

const STATEMENTS = Array.from({length: 45}, (_, i) => {
    const date = `2025-${String(12 - Math.floor(i / 10)).padStart(2, "0")}-${String(28 - (i % 10)).padStart(2, "0")}`;
    return makeStatement({id: `altman-${date}-x`, date});
});

let added: Parameters<Document["addEventListener"]>[] = [];
let phone: {matches: boolean; listeners: (() => void)[]};

beforeEach(() => {
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((...args: Parameters<Document["addEventListener"]>) => {
        added.push(args);
        add(...args);
    });
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
    phone = {matches: true, listeners: []};
    vi.stubGlobal("matchMedia", (query: string) =>
        query === "(max-width: 599px)"
            ? {
                  get matches() {
                      return phone.matches;
                  },
                  addEventListener: (_: string, fn: () => void) => phone.listeners.push(fn),
              }
            : {matches: false, addEventListener: vi.fn()}
    );
});

afterEach(() => {
    for (const args of added) document.removeEventListener(...args);
    added = [];
    vi.restoreAllMocks();
    document.documentElement.innerHTML = "";
    vi.unstubAllGlobals();
});

async function mount(filters: Partial<ResultsFilters> = {}, scripts = ["results.js"]) {
    const site = await siteFor(STATEMENTS, "25-26", {view: "results"});
    const html = ResultsView({
        site,
        title: "t",
        filters: {ceo: undefined, count: undefined, sort: "newest", ...filters},
    });
    document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
    for (const script of scripts) runScript(script);
    return site;
}

const items = () => [...document.querySelectorAll<HTMLElement>(".results .match-item")];
const shown = () => items().filter((item) => !item.hidden).length;
const months = () => [...document.querySelectorAll<HTMLElement>(".results .month")].filter((m) => !m.hidden).length;
const more = () => document.querySelector<HTMLElement>(".more")!;
const resize = (matches: boolean) => {
    phone.matches = matches;
    for (const fn of phone.listeners) fn();
};

describe("the results script on a phone", () => {
    it("shows the first 20 cards and their months, keeping every card in the page", async () => {
        await mount();

        expect(items()).toHaveLength(45);
        expect(shown()).toBe(20);
        expect(months()).toBe(2);
        expect(more().hidden).toBe(false);
        expect(more().querySelector(".more-count")!.textContent).toBe("Showing 20 of 45 matches");
        expect(document.querySelector(".results")!.getAttribute("data-report-list")!.split(" ")).toHaveLength(45);
    });

    it("reveals 20 more per tap and moves focus to the first new card", async () => {
        await mount();
        const button = more().querySelector("button")!;

        button.click();

        expect(shown()).toBe(40);
        expect(months()).toBe(4);
        expect(document.activeElement).toBe(items()[20].querySelector("a"));

        button.click();

        expect(shown()).toBe(45);
        expect(more().hidden).toBe(true);
    });

    it("counts the filtered list", async () => {
        await mount({sort: "pitchforks"});

        expect(shown()).toBe(20);
        expect(more().querySelector(".more-count")!.textContent).toBe("Showing 20 of 45 matches");
    });

    it("shows every card from 600px up and keeps the reveal when it narrows again", async () => {
        await mount();
        more().querySelector("button")!.click();

        resize(false);

        expect(shown()).toBe(45);
        expect(more().hidden).toBe(true);

        resize(true);

        expect(shown()).toBe(40);
    });
});

describe("the results script with the report dialog", () => {
    const openAndClose = async (steps: number) => {
        const site = await mount({}, ["report.js", "results.js"]);
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                const id = decodeURIComponent(url.split("/").pop()!);
                const match = MatchView({site, title: "t", statement: site.league.byId.get(id)!});
                return {ok: true, text: async () => match};
            })
        );
        const report = document.getElementById("report") as HTMLDialogElement;
        const opener = items()[0].querySelector("a")!;
        opener.focus();
        opener.click();
        await vi.waitFor(() => expect(report.open).toBe(true));
        for (let i = 0; i < steps; i++) {
            const position = document.getElementById("report-position")!.textContent;
            report.querySelector<HTMLButtonElement>("[data-next]")!.click();
            await vi.waitFor(() => expect(document.getElementById("report-position")!.textContent).not.toBe(position));
        }
        expect(document.getElementById("report-position")!.textContent).toBe(`${steps + 1} of 45`);
        report.close();
    };

    it("walks every card and on close reveals up to the card it closed on and focuses it", async () => {
        await openAndClose(24);

        expect(shown()).toBe(40);
        expect(document.activeElement).toBe(items()[24].querySelector("a"));
    });

    it("returns focus to the opener from 600px up", async () => {
        phone.matches = false;

        await openAndClose(3);

        expect(shown()).toBe(45);
        expect(document.activeElement).toBe(items()[0].querySelector("a"));
    });
});
