import {chromium, type Browser, type Page} from "playwright";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BASE_URL} from "./helpers.js";

describe("the match dialog and the browser's Back button", () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch();
    });

    afterAll(async () => {
        await browser.close();
    });

    async function openFirst(page: Page) {
        const link = page.locator(".results a[data-report]").first();
        const id = await link.getAttribute("data-report");
        await link.click();
        await page.waitForURL(`**/match/${id}`);
        await expect.poll(() => page.locator("#report").evaluate((el: HTMLDialogElement) => el.open)).toBe(true);
    }

    const isOpen = (page: Page) => page.locator("#report").evaluate((el: HTMLDialogElement) => el.open);

    it("closes the dialog on Back and stays on the results", async () => {
        const page = await browser.newPage();
        await page.goto(BASE_URL + "/rules");
        await page.goto(BASE_URL + "/results");
        await openFirst(page);

        await page.goBack();
        await expect.poll(() => isOpen(page)).toBe(false);
        expect(new URL(page.url()).pathname).toBe("/results");

        await page.goForward();
        await expect.poll(() => isOpen(page)).toBe(true);
        expect(new URL(page.url()).pathname).toMatch(/^\/match\//);

        await page.keyboard.press("Escape");
        await expect.poll(() => new URL(page.url()).pathname).toBe("/results");
        expect(await isOpen(page)).toBe(false);

        await page.goBack();
        await page.waitForURL("**/rules");
        await page.close();
    });

    it("closes the dialog on the first of two quick Backs and leaves on the second", async () => {
        const page = await browser.newPage();
        await page.goto(BASE_URL + "/rules");
        await page.goto(BASE_URL + "/results");
        await openFirst(page);

        await page.evaluate(() => {
            history.back();
            history.back();
        });

        await page.waitForURL("**/rules");
        await page.close();
    });
});
