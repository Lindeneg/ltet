// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {makeStatement} from "../helpers.js";
import {siteFor} from "../ui/helpers.js";
import {ReportBody} from "../../../src/ui/components/report.js";
import {runScript} from "./run-script.js";

afterEach(() => {
    document.body.innerHTML = "";
    delete document.documentElement.dataset.js;
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.tableMode;
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
});

describe("theme boot", () => {
    it("marks that scripts run and applies the stored theme and table columns", () => {
        localStorage.setItem("ltet-theme", "dark");
        sessionStorage.setItem("ltet-table-mode", "form");

        runScript("theme-boot.js");

        const root = document.documentElement.dataset;
        expect(root.js).toBe("");
        expect(root.theme).toBe("dark");
        expect(root.tableMode).toBe("form");
    });

    it("ignores values it doesn't know", () => {
        localStorage.setItem("ltet-theme", "neon");
        sessionStorage.setItem("ltet-table-mode", "huge");

        runScript("theme-boot.js");

        expect(document.documentElement.dataset.theme).toBeUndefined();
        expect(document.documentElement.dataset.tableMode).toBeUndefined();
    });
});

describe("site script", () => {
    const mount = (html = "") => {
        vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: vi.fn()}));
        document.body.innerHTML = `<button id="theme-toggle"><svg><use href="#sun"/></svg><span class="theme-text"></span></button>${html}`;
        runScript("site.js");
    };

    it("keeps the table's columns for the visit", () => {
        mount(
            `<div id="table-mode"><button data-mode="short" aria-pressed="true"></button><button data-mode="full" aria-pressed="false"></button></div>`
        );

        document.querySelector<HTMLButtonElement>('[data-mode="full"]')!.click();

        expect(document.documentElement.dataset.tableMode).toBe("full");
        expect(sessionStorage.getItem("ltet-table-mode")).toBe("full");
        expect(document.querySelector('[data-mode="full"]')!.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector('[data-mode="short"]')!.getAttribute("aria-pressed")).toBe("false");
    });

    it("switches the theme and remembers it", () => {
        mount();

        document.getElementById("theme-toggle")!.click();

        expect(document.documentElement.dataset.theme).toBe("dark");
        expect(localStorage.getItem("ltet-theme")).toBe("dark");
        expect(document.getElementById("theme-toggle")!.getAttribute("aria-label")).toBe("Switch to light mode");
    });

    it("submits the sort form on change", () => {
        mount(`<form><select data-autosubmit><option>a</option><option>b</option></select></form>`);
        const form = document.querySelector("form")!;
        const submit = vi.fn((event: Event) => event.preventDefault());
        form.addEventListener("submit", submit);

        document.querySelector("select")!.dispatchEvent(new Event("change"));

        expect(submit).toHaveBeenCalled();
    });

    it("puts the initials crest in place of a photo that fails to load", () => {
        mount(`<span class="face sm gold" data-initials="SA"><img class="face-img" src="/x.jpg"></span>`);

        document.querySelector("img")!.dispatchEvent(new Event("error"));

        const crest = document.querySelector("svg.crest")!;
        expect(crest.getAttribute("class")).toBe("crest face-crest sm gold");
        expect(crest.textContent).toBe("SA");
    });
});

describe("season menu", () => {
    const mount = () => {
        vi.stubGlobal("matchMedia", () => ({matches: false, addEventListener: vi.fn()}));
        document.body.innerHTML = `<button id="theme-toggle"><svg><use href="#sun"/></svg><span class="theme-text"></span></button><details class="season-menu" open><summary>25/26</summary><nav><a href="/">All-time</a></nav></details><p id="outside">x</p>`;
        runScript("site.js");
        return document.querySelector("details")!;
    };

    it("closes on a tap outside it but not on one inside", () => {
        const menu = mount();

        document.querySelector("nav")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(menu.open).toBe(true);

        document.getElementById("outside")!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(menu.open).toBe(false);
    });

    it("closes on Escape and hands focus back to its button", () => {
        const menu = mount();

        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

        expect(menu.open).toBe(false);
        expect(document.activeElement).toBe(document.querySelector("summary"));
    });
});

describe("report script on the match page", () => {
    const mount = async () => {
        const site = await siteFor([makeStatement()], "25-26");
        document.body.innerHTML = `<article class="report-page"><div data-report-body>${ReportBody(site, site.ctx.statements[0])}</div></article>`;
        runScript("report.js");
    };

    it("switches tabs by click and arrow key", async () => {
        await mount();

        document.querySelector<HTMLButtonElement>('[role=tab][data-tab="sources"]')!.click();
        expect(document.getElementById("panel-sources")!.hidden).toBe(false);
        expect(document.getElementById("panel-stats")!.hidden).toBe(true);

        document
            .querySelector("[role=tablist]")!
            .dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        expect(document.getElementById("panel-stats")!.hidden).toBe(false);
    });

    it("asks for a count and a call before sending to VAR, then posts it", async () => {
        await mount();
        const fetch = vi.fn().mockResolvedValue({ok: true});
        vi.stubGlobal("fetch", fetch);
        const form = document.querySelector<HTMLFormElement>(".var-form")!;
        const error = form.querySelector(".form-error")!;
        document.querySelector<HTMLButtonElement>(".var-open")!.click();

        form.requestSubmit();
        expect(error.textContent).toBe("Pick the count you want the referee to look at.");

        form.querySelector<HTMLInputElement>('input[value="doom"]')!.checked = true;
        form.requestSubmit();
        expect(error.textContent).toBe("More pitchforks or fewer?");

        form.querySelector<HTMLInputElement>('input[value="more"]')!.checked = true;
        form.requestSubmit();
        await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".var-thanks")!.hidden).toBe(false));
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
            statementId: "altman-2025-09-01-statement",
            category: "doom",
            direction: "more",
            comment: "",
            website: "",
        });
    });

    it("shows the api's sentence when it refuses", async () => {
        await mount();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, json: async () => ({error: "Too many calls."})}));
        const form = document.querySelector<HTMLFormElement>(".var-form")!;
        document.querySelector<HTMLButtonElement>(".var-open")!.click();
        form.querySelector<HTMLInputElement>('input[value="doom"]')!.checked = true;
        form.querySelector<HTMLInputElement>('input[value="fewer"]')!.checked = true;

        form.requestSubmit();

        await vi.waitFor(() => expect(form.querySelector(".form-error")!.textContent).toBe("Too many calls."));
    });
});
