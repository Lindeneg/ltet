import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {JSDOM} from "jsdom";
import {describe, expect, it} from "vitest";
import {BASE_URL, get} from "./helpers.js";

describe("the public site", () => {
    it("serves the all-time table at /, with the front page's preview tags", async () => {
        const res = await get("/");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(res.html).toContain("<title>Let Them Eat Tokens</title>");
        expect(res.html).toContain(`<meta property="og:url" content="${BASE_URL}/">`);
        expect(res.html).toContain(`<meta property="og:image" content="${BASE_URL}/og.png">`);
        expect(res.html).toContain('<table class="league');
        expect(res.html).toContain('id="ticker-list"');
        expect(res.html).toContain('<span class="season-label">All-time</span>');
    });

    it("serves a season's table at its prefix", async () => {
        const season = await get("/25-26");

        expect(season.status).toBe(200);
        expect(season.html).toContain("League table 25/26 · Let Them Eat Tokens");
        expect(season.html).not.toContain("og:url");
        expect(season.html).toContain('<details class="season-menu">');
        expect(season.html).toContain('<svg class="tab-icon" aria-hidden="true"><use href="#tab-honours"/></svg>');
    });

    it("lets the page reach under the phone's home indicator", async () => {
        const res = await get("/rules");

        expect(res.html).toContain('content="width=device-width, initial-scale=1, viewport-fit=cover"');
        expect(res.html).not.toContain('class="season-menu"');
    });

    it.each([
        ["/all-time", "/"],
        ["/all-time/results?ceo=altman&sort=pitchforks", "/results?ceo=altman&sort=pitchforks"],
        ["/all-time/club/altman", "/club/altman"],
    ])("moves %s to %s for good", async (path, target) => {
        const res = await get(path);

        expect(res.status).toBe(301);
        expect(res.location).toBe(target);
    });

    it("serves no inline style, script or event handler, which the csp would block", async () => {
        const res = await get("/");

        expect(res.html).not.toMatch(/\sstyle=/);
        expect(res.html).not.toMatch(/\son[a-z]+=/);
        expect(res.html).not.toMatch(/<script>/);
    });

    it.each(["/99-00", "/nope", "/club/nobody", "/25-26/nothing"])("sends the site's 404 page for %s", async (path) => {
        const res = await get(path);

        expect(res.status).toBe(404);
        expect(res.html).toContain("<title>Not found · Let Them Eat Tokens</title>");
        expect(res.html).toContain("Offside");
    });

    it("serves the results with their filters, and a 404 for a filter it doesn't know", async () => {
        const res = await get("/results?ceo=altman&sort=pitchforks");
        const bad = await get("/results?ceo=nobody");

        expect(res.status).toBe(200);
        expect(res.html).toContain("Results all-time · Let Them Eat Tokens");
        expect(res.html).toContain('<span class="m-rank">#1</span>');
        expect(res.html).toContain('<span class="filter-bar-choice">Altman · Any count</span>');
        expect(bad.status).toBe(404);
    });

    it.each([
        ["/race", "The race all-time"],
        ["/26-27/race", "The race 26/27"],
        ["/25-26/honours", "Honours 25/26"],
        ["/rules", "Laws of the game"],
        ["/club/altman", "Sam Altman all-time"],
    ])("serves %s", async (path, title) => {
        const res = await get(path);

        expect(res.status).toBe(200);
        expect(res.html).toContain(`<title>${title} · Let Them Eat Tokens</title>`);
        expect(res.html).not.toMatch(/\sstyle=/);
        expect(res.html).not.toMatch(/\son[a-z]+=/);
        expect(res.html).not.toMatch(/<script>/);
    });

    it("lists the contenders under the race chart as follow buttons, and under a club's chart as links", async () => {
        const race = await get("/race");
        const club = await get("/club/altman");

        expect(race.html).toMatch(
            /<ol class="race-rank"[^>]*>(<li><button type="button" data-follow="[a-z]+" aria-pressed="(true|false)">.*?<\/button><\/li>){9}<\/ol>/
        );
        expect(club.html).toMatch(
            /<ol class="race-rank" aria-label="Contenders">(<li><a href="\/club\/[a-z]+".*?<\/a><\/li>){9}<\/ol>/
        );
        expect(club.html).toContain(`<a href="/club/altman" aria-current="page">`);
    });

    it("folds the table's key into a disclosure", async () => {
        const res = await get("/");

        expect(res.html).toContain('<details class="table-key"><summary class="key-toggle">Key</summary>');
    });

    it("credits the photos on the rules page and not on a contender's page", async () => {
        const club = await get("/club/altman");
        const rules = await get("/rules");

        expect(club.html).not.toContain("Photo:");
        expect(club.html).not.toContain("Wikimedia Commons");
        expect(rules.html).toContain("Wikimedia Commons");
    });

    it.each(["/25-26/rules", "/club/nobody"])("sends the site's 404 page for %s", async (path) => {
        expect((await get(path)).status).toBe(404);
    });

    it("shows a phone the first 20 results and 20 more per tap, with every card still in the list", async () => {
        const {html} = await get("/results");
        const {window} = new JSDOM(html, {url: `${BASE_URL}/results`, runScripts: "outside-only"});
        window.matchMedia = ((query: string) => ({
            matches: query === "(max-width: 599px)",
            addEventListener: () => {},
        })) as unknown as typeof window.matchMedia;
        window.eval(readFileSync(resolve(import.meta.dirname, "../../public/results.js"), "utf8"));
        const {document} = window;
        const items = [...document.querySelectorAll<HTMLElement>(".results .match-item")];
        const shown = () => items.filter((item) => !item.hidden).length;
        const ids = document.querySelector(".results")!.getAttribute("data-report-list")!.split(" ");

        expect(shown()).toBe(20);
        expect(document.querySelector(".more-count")!.textContent).toBe(`Showing 20 of ${items.length} matches`);

        document.querySelector<HTMLButtonElement>(".more button")!.click();

        expect(shown()).toBe(40);
        expect(ids).toHaveLength(items.length);
    });

    it.each(["/race-chart.js", "/rules.js", "/results.js"])("serves %s", async (path) => {
        expect((await get(path)).status).toBe(200);
    });

    it("serves a match report as its own page", async () => {
        const id = "pichai-2023-01-12000-layoffs-full-responsibility";
        const res = await get(`/match/${id}`);

        expect(res.status).toBe(200);
        expect(res.html).toContain("· Let Them Eat Tokens</title>");
        expect(res.html).toContain("data-report-body");
        expect(res.html).toContain(`data-copy="/s/${id}"`);
        expect((await get("/match/nope")).status).toBe(404);
    });

    it("answers a missing file with a plain 404", async () => {
        const res = await get("/missing.css");

        expect(res.status).toBe(404);
        expect(res.html).toBe("Not found");
    });

    it.each(["/theme-boot.js", "/site.js", "/ticker.js", "/report.js", "/widths.css"])("serves %s", async (path) => {
        expect((await get(path)).status).toBe(200);
    });
});
