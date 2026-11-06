import {chromium, type Browser} from "playwright";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BASE_URL, get} from "./helpers.js";

const table = await get("/");
const seasons = [...new Set([...table.html.matchAll(/href="\/(\d\d-\d\d)"/g)].map((m) => m[1]))];
const match = (await get("/results")).html.match(/href="(\/match\/[a-z0-9-]+)"/)?.[1];
if (!seasons.length || !match) throw new Error("the seeded site has no seasons or matches to check");

describe("what the site hides", () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser.close();
    });

    async function fixture(path: string) {
        const page = await browser.newPage();
        await page.goto(BASE_URL + path);
        const found = await page.locator(".next-fixture").evaluate((el) => ({
            hidden: el.hasAttribute("hidden"),
            display: getComputedStyle(el).display,
        }));
        await page.close();
        return found;
    }

    it("shows the next fixture on the all-time results", async () => {
        expect(await fixture("/results")).toEqual({hidden: false, display: "flex"});
    });

    it.each(seasons)("shows the next fixture on %s only while that season runs", async (season) => {
        const {hidden, display} = await fixture(`/${season}/results`);

        expect(display).toBe(hidden ? "none" : "flex");
    });

    it("hides the next fixture on a finished season", async () => {
        const found = await Promise.all(seasons.map((season) => fixture(`/${season}/results`)));

        expect(found).toContainEqual({hidden: true, display: "none"});
    });

    it("shows every panel of a match report without javascript", async () => {
        const context = await browser.newContext({javaScriptEnabled: false});
        const page = await context.newPage();
        await page.goto(BASE_URL + match);

        const panels = await page
            .locator(".rp-panel")
            .evaluateAll((els) => els.map((el) => getComputedStyle(el).display));
        await context.close();

        expect(panels.length).toBeGreaterThan(1);
        expect(panels).not.toContain("none");
    });
});
