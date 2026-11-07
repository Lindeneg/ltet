// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {runScript} from "./run-script.js";

let observed: (entries: {target: Element; isIntersecting: boolean}[]) => void;

beforeEach(() => {
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: typeof observed) {
                observed = callback;
            }
            observe() {}
        }
    );
    vi.stubGlobal("matchMedia", () => ({matches: true}));
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = `<ol class="law-index">${["scoring", "table"]
        .map(
            (id, i) =>
                `<li><a href="#law-${id}" data-law="${id}"${i === 0 ? ` aria-current="true"` : ""}>${id}</a></li>`
        )
        .join("")}</ol>${["scoring", "table"]
        .map((id) => `<section id="law-${id}"><h2 id="law-${id}-title" tabindex="-1">${id}</h2></section>`)
        .join("")}`;
    runScript("rules.js");
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
});

const current = () => document.querySelector<HTMLElement>(".law-index [aria-current]")?.dataset.law;

describe("rules index", () => {
    it("scrolls to a law without motion when reduced, and focuses its heading", () => {
        document.querySelector<HTMLElement>('[data-law="table"]')!.click();

        expect(document.activeElement!.id).toBe("law-table-title");
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({behavior: "auto", block: "start"});
    });

    it("marks the first law in view", () => {
        const [scoring, table] = document.querySelectorAll("section");

        observed([
            {target: scoring, isIntersecting: false},
            {target: table, isIntersecting: true},
        ]);

        expect(current()).toBe("table");
        expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
    });

    it("marks a clicked law at once", () => {
        document.querySelector<HTMLElement>('[data-law="table"]')!.click();

        expect(current()).toBe("table");
    });

    it("marks the last law at the bottom of the page, even with an earlier law in view", () => {
        const [scoring, table] = document.querySelectorAll("section");
        Object.defineProperty(document.documentElement, "scrollHeight", {configurable: true, value: 2000});
        vi.stubGlobal("innerHeight", 800);
        vi.stubGlobal("requestAnimationFrame", (run: () => void) => run());

        vi.stubGlobal("scrollY", 400);
        observed([
            {target: scoring, isIntersecting: true},
            {target: table, isIntersecting: true},
        ]);
        expect(current()).toBe("scoring");

        vi.stubGlobal("scrollY", 1200);
        window.dispatchEvent(new Event("scroll"));
        expect(current()).toBe("table");

        vi.stubGlobal("scrollY", 400);
        window.dispatchEvent(new Event("scroll"));
        expect(current()).toBe("scoring");
    });

    it("keeps marking the first law in view on a page too short to scroll", () => {
        const [scoring, table] = document.querySelectorAll("section");
        Object.defineProperty(document.documentElement, "scrollHeight", {configurable: true, value: 600});
        vi.stubGlobal("innerHeight", 800);

        observed([
            {target: scoring, isIntersecting: true},
            {target: table, isIntersecting: true},
        ]);

        expect(current()).toBe("scoring");
    });
});
