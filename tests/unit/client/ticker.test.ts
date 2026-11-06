// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Ticker} from "../../../src/ui/components/ticker.js";
import {makeStatement} from "../helpers.js";
import {siteFor} from "../ui/helpers.js";
import {runScript} from "./run-script.js";

let frames: Map<number, FrameRequestCallback>;
let reduced: {matches: boolean; listeners: (() => void)[]};
let intersect: (entries: {isIntersecting: boolean}[]) => void;
let hidden: boolean;

beforeEach(() => {
    frames = new Map();
    let next = 0;
    reduced = {matches: false, listeners: []};
    hidden = false;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.set(++next, callback);
        return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("matchMedia", () => ({
        get matches() {
            return reduced.matches;
        },
        addEventListener: (_: string, listener: () => void) => reduced.listeners.push(listener),
    }));
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
        }
    );
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            constructor(callback: typeof intersect) {
                intersect = callback;
            }
            observe() {}
        }
    );
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({width: 600} as DOMRect);
});

afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function start(paused = false) {
    const site = await siteFor([makeStatement(), makeStatement({id: "second", date: "2025-10-01"})]);
    document.body.innerHTML = Ticker(site.league.newest, paused);
    runScript("ticker.js");
}

const toggle = () => document.getElementById("ticker-toggle")!;
const running = () => frames.size > 0;

function setReduced(matches: boolean) {
    reduced.matches = matches;
    for (const listener of reduced.listeners) listener();
}

describe("the ticker", () => {
    it("moves the belt while it runs", async () => {
        await start();
        const step = (time: number) => {
            const [id, callback] = [...frames][0];
            frames.delete(id);
            callback(time);
        };

        step(1000);
        step(1100);

        expect(running()).toBe(true);
        expect(document.getElementById("ticker-belt")!.style.transform).toBe("translate3d(-4.5px, 0, 0)");
    });

    it("stops its loop while paused and starts it again on play", async () => {
        await start();

        toggle().click();
        expect(running()).toBe(false);
        expect(toggle().getAttribute("aria-label")).toBe("Play the results ticker");

        toggle().click();
        expect(running()).toBe(true);
    });

    it("stops under reduced motion, stays still when played, and runs when motion is allowed again", async () => {
        await start();

        setReduced(true);
        expect(running()).toBe(false);

        toggle().click();
        toggle().click();
        expect(running()).toBe(false);

        setReduced(false);
        expect(running()).toBe(true);
    });

    it("never starts under reduced motion", async () => {
        reduced.matches = true;
        await start();

        expect(running()).toBe(false);
    });

    it("stops while off screen", async () => {
        await start();

        intersect([{isIntersecting: false}]);
        expect(running()).toBe(false);

        intersect([{isIntersecting: true}]);
        expect(running()).toBe(true);
    });

    it("stops while the tab is hidden", async () => {
        await start();

        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
        expect(running()).toBe(false);

        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        expect(running()).toBe(true);
    });

    it("starts paused when the page asks, showing the play button", async () => {
        await start(true);

        expect(running()).toBe(false);
        expect(toggle().getAttribute("aria-label")).toBe("Play the results ticker");
        expect(toggle().querySelector("use")!.getAttribute("href")).toBe("#play");

        toggle().click();
        expect(running()).toBe(true);
        expect(toggle().getAttribute("aria-label")).toBe("Pause the results ticker");
    });
});
