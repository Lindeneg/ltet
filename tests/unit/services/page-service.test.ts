import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import LeagueService from "../../../src/services/league-service.js";
import PageCacheService from "../../../src/services/page-cache-service.js";
import PageService from "../../../src/services/page-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {fake, makeContent, makeStatement, makeContentService} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 15, 12);
const ORIGIN = "http://localhost:3000";

function makePages(statements: RawStatement[] = [makeStatement()]) {
    const listPublished = vi.fn().mockResolvedValue(success(statements));
    const content = makeContent();
    const league = new LeagueService(
        fake<StatementRepository>({listPublished}),
        makeContentService(content),
        () => NOW
    );
    const cache = new PageCacheService(10);
    const set = vi.spyOn(cache, "set");
    const get = vi.spyOn(cache, "get");
    const stored = () => set.mock.calls.length;
    const hits = () => get.mock.results.filter((r) => r.value !== undefined).length;
    return {listPublished, league, stored, hits, pages: new PageService(league, makeContentService(content), cache)};
}

async function html(result: Promise<{ok: boolean; data?: string; ctx?: unknown}>) {
    const r = await result;
    if (!r.ok) throw new Error(String(r.ctx));
    return r.data as string;
}

describe("PageService", () => {
    describe("getTable", () => {
        it("titles the all-time table with the site's name alone", async () => {
            const {pages} = makePages();

            const page = await html(pages.getTable({season: undefined}, ORIGIN));

            expect(page).toContain("<title>Let Them Eat Tokens</title>");
            expect(page).toContain("League table");
        });

        it("names the view and the season for any other season", async () => {
            const {pages} = makePages();

            expect(await html(pages.getTable({season: "25-26"}, ORIGIN))).toContain(
                "<title>League table 25/26 · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getTable({season: "26-27"}, ORIGIN))).toContain(
                "<title>League table 26/27 · Let Them Eat Tokens</title>"
            );
        });

        it("is a 404 for all time by its key, which has no path of its own", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getTable({season: "all-time"}, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
            expect(await pages.getResults({season: "all-time"}, {})).toEqual(failure(AppError.NOT_FOUND));
            expect(stored()).toBe(0);
        });

        it("is a 404 for a season the league doesn't have", async () => {
            const {pages} = makePages();

            expect(await pages.getTable({season: "99-00"}, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
        });

        it("passes on a failing database", async () => {
            const {pages, listPublished} = makePages();
            listPublished.mockResolvedValue(failure(AppError.DB_ERROR));

            expect(await pages.getTable({season: undefined}, ORIGIN)).toEqual(failure(AppError.DB_ERROR));
        });

        it("gives the front page alone og:url and og:image, from the base it is given", async () => {
            const {pages} = makePages();

            const front = await html(pages.getTable({season: undefined}, ORIGIN));
            const other = await html(pages.getTable({season: "25-26"}, ORIGIN));

            expect(front).toContain(`<meta property="og:url" content="${ORIGIN}/">`);
            expect(front).toContain(`<meta property="og:image" content="${ORIGIN}/og.png">`);
            expect(front).not.toContain("<!--preview-->");
            expect(other).not.toContain("og:url");
        });

        it("caches the front page once whatever the origin", async () => {
            const {pages, stored} = makePages();

            const first = await html(pages.getTable({season: undefined}, ORIGIN));
            const second = await html(pages.getTable({season: undefined}, "http://evil.example"));

            expect(stored()).toBe(1);
            expect(second).toBe(first.replaceAll(ORIGIN, "http://evil.example"));
        });

        it("serves a cached page until the league changes", async () => {
            const {pages, league, listPublished, stored, hits} = makePages();

            await pages.getTable({season: "25-26"}, ORIGIN);
            await pages.getTable({season: "25-26"}, ORIGIN);
            expect(stored()).toBe(1);
            expect(hits()).toBe(1);

            listPublished.mockResolvedValue(success([makeStatement(), makeStatement({id: "second"})]));
            league.invalidate();
            const page = await html(pages.getTable({season: "25-26"}, ORIGIN));

            expect(page).toContain("final table, 2 matches");
            expect(stored()).toBe(2);
            expect(hits()).toBe(1);
        });
    });

    describe("getResults", () => {
        const all = {season: undefined};

        it("filters, sorts and titles the results", async () => {
            const {pages} = makePages([
                makeStatement(),
                makeStatement({id: "musk-2025-10-01-x", ceo: "musk", date: "2025-10-01"}),
            ]);

            const page = await html(pages.getResults(all, {ceo: "musk", sort: "oldest"}));

            expect(page).toContain("<title>Results all-time · Let Them Eat Tokens</title>");
            expect(page).toContain("1 match of 2 on the record");
            expect(page).toContain('data-report-list="musk-2025-10-01-x"');
        });

        it.each([{ceo: "nobody"}, {count: "nothing"}, {sort: "random"}])("is a 404 for %o", async (query) => {
            const {pages} = makePages();

            expect(await pages.getResults(all, query)).toEqual(failure(AppError.NOT_FOUND));
        });

        it("takes blank values as unset and newest as the default, so they share one page", async () => {
            const {pages, stored} = makePages();

            const plain = await html(pages.getResults(all, {}));
            const blank = await html(pages.getResults(all, {ceo: "", count: "", sort: ""}));
            const newest = await html(pages.getResults(all, {sort: "newest"}));

            expect(blank).toBe(plain);
            expect(newest).toBe(plain);
            expect(stored()).toBe(1);
        });

        it("is a 404 for a season the league doesn't have", async () => {
            const {pages} = makePages();

            expect(await pages.getResults({season: "99-00"}, {})).toEqual(failure(AppError.NOT_FOUND));
        });
    });

    describe("getMatch", () => {
        it("renders the report in the chrome of the statement's own season", async () => {
            const {pages} = makePages([makeStatement(), makeStatement({id: "later", date: "2026-09-01"})]);

            const page = await html(pages.getMatch("altman-2025-09-01-statement"));

            expect(page).toContain("<title>A headline · Let Them Eat Tokens</title>");
            expect(page).toContain('<span class="season-label">Season 25/26</span>');
            expect(page).toContain('<span class="report-position">1 of 2</span>');
            expect(page).toContain('href="/match/later"');
            expect(page).toContain('data-copy="/s/altman-2025-09-01-statement"');
            expect(page).not.toContain('class="seasonbar"');
        });

        it("is a 404 for a statement the league doesn't have", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getMatch("nope")).toEqual(failure(AppError.NOT_FOUND));
            expect(stored()).toBe(0);
        });
    });

    describe("error pages", () => {
        it("render in the site's shell with the ticker", async () => {
            const {pages} = makePages();

            const notFound = await pages.getNotFound();
            const serverError = await pages.getServerError();

            expect(notFound).toContain("<title>Not found · Let Them Eat Tokens</title>");
            expect(notFound).toContain("Offside");
            expect(notFound).toContain("There&#39;s no page at this address.");
            expect(notFound).toContain('id="ticker"');
            expect(serverError).toContain("Match suspended");
            expect(serverError).toContain("Something went wrong on our side. Try again in a moment.");
            expect(notFound).toContain(`<meta name="robots" content="noindex">`);
            expect(serverError).toContain(`<meta name="robots" content="noindex">`);
        });

        it("leave other pages indexable", async () => {
            const {pages} = makePages();

            expect(await html(pages.getRace({season: undefined}))).not.toContain(`name="robots"`);
        });

        it("render without the league when it can't load", async () => {
            const {pages, listPublished} = makePages();
            listPublished.mockResolvedValue(failure(AppError.DB_ERROR));

            const serverError = await pages.getServerError();

            expect(serverError).toContain("Match suspended");
            expect(serverError).not.toContain('id="ticker"');
        });

        it("are never cached", async () => {
            const {pages, stored} = makePages();

            await pages.getNotFound();
            await pages.getServerError();
            await pages.getTable({season: "99-00"}, ORIGIN);

            expect(stored()).toBe(0);
        });
    });

    describe("the race, honours, rules and club pages", () => {
        it("title each page by its view and season", async () => {
            const {pages} = makePages();

            expect(await html(pages.getRace({season: "26-27"}))).toContain(
                "<title>The race 26/27 · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getHonours({season: undefined}))).toContain(
                "<title>Honours all-time · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getRules())).toContain("<title>Laws of the game · Let Them Eat Tokens</title>");
            expect(await html(pages.getClub({season: "25-26"}, "altman"))).toContain(
                "<title>Sam Altman 25/26 · Let Them Eat Tokens</title>"
            );
        });

        it("are a 404 for an unknown season or contender, which is never cached", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getRace({season: "99-00"})).toEqual(failure(AppError.NOT_FOUND));
            expect(await pages.getClub({season: undefined}, "nobody")).toEqual(failure(AppError.NOT_FOUND));
            expect(stored()).toBe(0);
        });

        it("cache a contender's page per season", async () => {
            const {pages, stored, hits} = makePages();

            await pages.getClub({season: undefined}, "altman");
            await pages.getClub({season: "25-26"}, "altman");
            await pages.getClub({season: "25-26"}, "altman");

            expect(stored()).toBe(2);
            expect(hits()).toBe(1);
        });
    });
});
