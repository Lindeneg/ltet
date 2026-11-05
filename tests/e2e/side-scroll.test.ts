import {chromium, type Browser, type Page} from "playwright";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BASE_URL, get} from "./helpers.js";

const WIDTHS = [320, 390, 768];

const table = await get("/");
const clubs = [...new Set([...table.html.matchAll(/href="(\/club\/[a-z0-9-]+)"/g)].map((m) => m[1]))];
const results = await get("/results");
const match = results.html.match(/href="(\/match\/[a-z0-9-]+)"/)?.[1];
if (!clubs.length || !match) throw new Error("the seeded site has no clubs or matches to check");

const PATHS = [
    "/",
    "/25-26",
    "/results",
    "/results?ceo=altman",
    "/25-26/results",
    "/race",
    "/25-26/race",
    "/honours",
    "/rules",
    match,
    "/no-such-page",
    ...clubs,
];

function sideScroll(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const found: string[] = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth) found.push(`the page, ${root.scrollWidth} in ${root.clientWidth}`);
        for (const el of document.querySelectorAll("body *")) {
            if (el.closest(".ticker")) continue;
            const overflow = getComputedStyle(el).overflowX;
            if ((overflow === "auto" || overflow === "scroll") && el.scrollWidth > el.clientWidth + 1) {
                found.push(
                    `${el.tagName.toLowerCase()}.${el.classList[0] ?? ""}, ${el.scrollWidth} in ${el.clientWidth}`
                );
            }
        }
        return found;
    });
}

describe("the public site on narrow screens", () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser.close();
    });

    describe.each(WIDTHS)("at %ipx", (width) => {
        it.each(PATHS)("scrolls nothing sideways on %s", async (path) => {
            const phone = width < 600;
            const context = await browser.newContext({
                viewport: {width, height: 800},
                isMobile: phone,
                hasTouch: phone,
            });
            const page = await context.newPage();
            await page.goto(BASE_URL + path, {waitUntil: "networkidle"});
            await page.evaluate(() => {
                for (const details of document.querySelectorAll("details")) details.open = true;
            });

            const found = await sideScroll(page);
            for (const mode of await page.locator("button[data-mode]").all()) {
                await mode.click();
                const name = await mode.textContent();
                found.push(...(await sideScroll(page)).map((line) => `${line}, in ${name}`));
            }
            await context.close();

            expect(found).toEqual([]);
        });
    });
});
