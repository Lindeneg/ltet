import {chromium, type Browser} from "playwright";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BASE_URL} from "./helpers.js";

describe("the race without scripts", () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser.close();
    });

    it.each([1280, 390])("shows no follow buttons at %ipx", async (width) => {
        const context = await browser.newContext({viewport: {width, height: 800}, javaScriptEnabled: false});
        const page = await context.newPage();
        await page.goto(BASE_URL + "/race");

        expect(await page.locator(".race-frame").isVisible()).toBe(true);
        expect(await page.locator("button[data-follow]:visible").count()).toBe(0);
        await context.close();
    });

    it.each([1280, 390])("shows the follow buttons with scripts at %ipx", async (width) => {
        const context = await browser.newContext({viewport: {width, height: 800}});
        const page = await context.newPage();
        await page.goto(BASE_URL + "/race");

        expect(await page.locator("button[data-follow]:visible").count()).toBeGreaterThan(0);
        await context.close();
    });
});
