import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {Photo, RawStatement} from "../../../src/lib/content.js";
import LeagueService from "../../../src/services/league-service.js";
import PageCacheService from "../../../src/services/page-cache-service.js";
import PageService from "../../../src/services/page-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {esc} from "../../../src/ui/lib.js";
import {fake, makeCeo, makeContent, makeStatement, makeContentService} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 15, 12);
const ORIGIN = "http://localhost:3000";

function makePages(statements: RawStatement[] = [makeStatement()], content = makeContent()) {
    const listPublished = vi.fn().mockResolvedValue(success(statements));
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
            expect(await pages.getResults({season: "all-time"}, {}, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
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
            expect(front).toContain(
                `<meta property="og:image:alt" content="The all-time league table, every contender ranked by pitchforks">`
            );
            expect(front).toContain(
                `<meta name="twitter:image:alt" content="The all-time league table, every contender ranked by pitchforks">`
            );
            expect(front).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
            expect(front).not.toContain("<!--preview-->");
            expect(other).toContain(`<meta property="og:url" content="${ORIGIN}/25-26">`);
            expect(other).not.toContain("og:image");
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

            const page = await html(pages.getResults(all, {ceo: "musk", sort: "oldest"}, ORIGIN));

            expect(page).toContain("<title>Results all-time · Let Them Eat Tokens</title>");
            expect(page).toContain("1 match of 2 on the record");
            expect(page).toContain('data-report-list="musk-2025-10-01-x"');
        });

        it.each([{ceo: "nobody"}, {count: "nothing"}, {sort: "random"}])("is a 404 for %o", async (query) => {
            const {pages} = makePages();

            expect(await pages.getResults(all, query, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
        });

        it("takes blank values as unset and newest as the default, so they share one page", async () => {
            const {pages, stored} = makePages();

            const plain = await html(pages.getResults(all, {}, ORIGIN));
            const blank = await html(pages.getResults(all, {ceo: "", count: "", sort: ""}, ORIGIN));
            const newest = await html(pages.getResults(all, {sort: "newest"}, ORIGIN));

            expect(blank).toBe(plain);
            expect(newest).toBe(plain);
            expect(stored()).toBe(1);
        });

        it("is a 404 for a season the league doesn't have", async () => {
            const {pages} = makePages();

            expect(await pages.getResults({season: "99-00"}, {}, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
        });
    });

    describe("getMatch", () => {
        it("renders the report in the chrome of the statement's own season", async () => {
            const {pages} = makePages([makeStatement(), makeStatement({id: "later", date: "2026-09-01"})]);

            const page = await html(pages.getMatch("altman-2025-09-01-statement", ORIGIN));

            expect(page).toContain("<title>A headline · Let Them Eat Tokens</title>");
            expect(page).toContain('<span class="season-label">Season 25/26</span>');
            expect(page).toContain('<span class="report-position">1 of 2</span>');
            expect(page).toContain('href="/match/later"');
            expect(page).toContain('data-copy="/s/altman-2025-09-01-statement"');
            expect(page).not.toContain('class="seasonbar"');
        });

        it("is a 404 for a statement the league doesn't have", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getMatch("nope", ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
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

            expect(await html(pages.getRace({season: "26-27"}, ORIGIN))).toContain(
                "<title>The race 26/27 · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getHonours({season: undefined}, ORIGIN))).toContain(
                "<title>Honours all-time · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getRules(ORIGIN))).toContain(
                "<title>Laws of the game · Let Them Eat Tokens</title>"
            );
            expect(await html(pages.getClub({season: "25-26"}, "altman", ORIGIN))).toContain(
                "<title>Sam Altman 25/26 · Let Them Eat Tokens</title>"
            );
        });

        it("are a 404 for an unknown season or contender, which is never cached", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getRace({season: "99-00"}, ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
            expect(await pages.getClub({season: undefined}, "nobody", ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
            expect(stored()).toBe(0);
        });

        it("cache a contender's page per season", async () => {
            const {pages, stored, hits} = makePages();

            await pages.getClub({season: undefined}, "altman", ORIGIN);
            await pages.getClub({season: "25-26"}, "altman", ORIGIN);
            await pages.getClub({season: "25-26"}, "altman", ORIGIN);

            expect(stored()).toBe(2);
            expect(hits()).toBe(1);
        });
    });

    describe("head tags", () => {
        const LD = /<script type="application\/ld\+json">(.*?)<\/script>/g;
        const jsonLd = (page: string) => [...page.matchAll(LD)].map((m) => JSON.parse(m[1]) as Record<string, any>);
        const ofType = (page: string, type: string) => jsonLd(page).find((item) => item["@type"] === type);
        const tag = (page: string, pattern: RegExp) => page.match(pattern)?.[1];
        const canonical = (page: string) => tag(page, /<link rel="canonical" href="([^"]*)">/);
        const description = (page: string) => tag(page, /<meta name="description" content="([^"]*)">/);
        const match = makeStatement({
            id: "musk-2025-10-01-tricky",
            ceo: "musk",
            date: "2025-10-01",
            headline: {text: 'He said "</script><!--" again', outlet: "Outlet", url: "https://one.example/m"},
            quote: 'First line\n</script><script>alert(1)</script> <!-- and "quoted" & more words that run on and on until the description has to be cut somewhere sensible near the end of it all',
        });

        it("gives every page one canonical, its own description and a WebSite", async () => {
            const {pages} = makePages([makeStatement(), match]);

            const all = await Promise.all([
                html(pages.getTable({season: undefined}, ORIGIN)),
                html(pages.getTable({season: "25-26"}, ORIGIN)),
                html(pages.getResults({season: undefined}, {}, ORIGIN)),
                html(pages.getResults({season: "25-26"}, {}, ORIGIN)),
                html(pages.getRace({season: undefined}, ORIGIN)),
                html(pages.getHonours({season: "25-26"}, ORIGIN)),
                html(pages.getRules(ORIGIN)),
                html(pages.getClub({season: undefined}, "altman", ORIGIN)),
                html(pages.getMatch(match.id, ORIGIN)),
            ]);

            expect(all.map(canonical)).toEqual([
                `${ORIGIN}/`,
                `${ORIGIN}/25-26`,
                `${ORIGIN}/results`,
                `${ORIGIN}/25-26/results`,
                `${ORIGIN}/race`,
                `${ORIGIN}/25-26/honours`,
                `${ORIGIN}/rules`,
                `${ORIGIN}/club/altman`,
                `${ORIGIN}/match/${match.id}`,
            ]);
            for (const page of all) {
                expect(page.match(/rel="canonical"/g)).toHaveLength(1);
                expect(page.match(/name="description"/g)).toHaveLength(1);
                expect(page).toContain(`<meta property="og:url" content="${canonical(page)}">`);
                expect(page).toContain('<meta property="og:site_name" content="Let Them Eat Tokens">');
                expect(ofType(page, "WebSite")).toEqual({
                    "@context": "https://schema.org",
                    "@type": "WebSite",
                    name: "Let Them Eat Tokens",
                    url: `${ORIGIN}/`,
                });
                expect(page).not.toContain('name="robots"');
            }
            expect(description(all[1])).toContain("Season 25/26 league table, final table after 2 matches");
            expect(description(all[3])).toContain("Every result in Season 25/26");
        });

        it("gives every page a unique title", async () => {
            const {pages} = makePages([makeStatement(), match]);
            const paths = await Promise.all([
                html(pages.getTable({season: undefined}, ORIGIN)),
                html(pages.getTable({season: "25-26"}, ORIGIN)),
                html(pages.getTable({season: "26-27"}, ORIGIN)),
                html(pages.getResults({season: undefined}, {}, ORIGIN)),
                html(pages.getResults({season: "25-26"}, {}, ORIGIN)),
                html(pages.getRace({season: undefined}, ORIGIN)),
                html(pages.getRace({season: "25-26"}, ORIGIN)),
                html(pages.getHonours({season: undefined}, ORIGIN)),
                html(pages.getRules(ORIGIN)),
                html(pages.getClub({season: undefined}, "altman", ORIGIN)),
                html(pages.getClub({season: "25-26"}, "altman", ORIGIN)),
                html(pages.getClub({season: undefined}, "musk", ORIGIN)),
                html(pages.getMatch(match.id, ORIGIN)),
                html(pages.getMatch("altman-2025-09-01-statement", ORIGIN)),
            ]);
            const titles = paths.map((page) => tag(page, /<title>([^<]*)<\/title>/));

            expect(new Set(titles).size).toBe(titles.length);
        });

        it("marks a filtered or sorted results view noindex with the unfiltered canonical", async () => {
            const {pages} = makePages();

            for (const query of [{ceo: "musk"}, {count: "doom"}, {sort: "oldest"}]) {
                const page = await html(pages.getResults({season: "25-26"}, query, ORIGIN));
                expect(page).toContain('<meta name="robots" content="noindex, follow">');
                expect(canonical(page)).toBe(`${ORIGIN}/25-26/results`);
            }
            const blank = await html(pages.getResults({season: "25-26"}, {ceo: "", sort: "newest"}, ORIGIN));
            expect(blank).not.toContain('name="robots"');
        });

        it("keeps the JSON-LD inside its script whatever the quote holds", async () => {
            const {pages} = makePages([match]);

            const page = await html(pages.getMatch(match.id, ORIGIN));
            const scripts = page.split('<script type="application/ld+json">').slice(1);

            for (const script of scripts) {
                const body = script.slice(0, script.indexOf("</script>"));
                expect(body).not.toContain("<");
                expect(() => JSON.parse(body)).not.toThrow();
            }
            expect(ofType(page, "Article")?.hasPart.text).toBe(match.quote);
            expect(ofType(page, "Article")?.headline).toBe(match.headline.text);
        });

        it("describes a match page as an article about its contender", async () => {
            const {pages} = makePages([match]);

            const page = await html(pages.getMatch(match.id, ORIGIN));
            const article = ofType(page, "Article");
            const crumbs = ofType(page, "BreadcrumbList");

            expect(page).toContain('<meta property="og:type" content="article">');
            expect(page).toContain(`<meta property="og:image" content="${ORIGIN}/og/${match.id}.png">`);
            const alt = page.match(/<meta property="og:image:alt" content="([^"]*)">/)?.[1];
            expect(alt).toMatch(
                /^Elon Musk: “He said &quot;&lt;\/script&gt;&lt;!--&quot; again”, \d+ pitchforks? of \d+$/
            );
            expect(page).toContain(`<meta name="twitter:image:alt" content="${alt}">`);
            expect(canonical(page)).toBe(`${ORIGIN}/match/${match.id}`);
            expect(article).toMatchObject({
                "@context": "https://schema.org",
                datePublished: "2025-10-01",
                dateModified: "2025-10-01",
                image: [`${ORIGIN}/og/${match.id}.png`],
                mainEntityOfPage: `${ORIGIN}/match/${match.id}`,
                author: {"@type": "Organization", name: "Let Them Eat Tokens", url: `${ORIGIN}/`},
                publisher: {"@type": "Organization", name: "Let Them Eat Tokens", url: `${ORIGIN}/`},
                about: {"@type": "Person", name: "Elon Musk"},
                hasPart: {"@type": "Quotation", spokenByCharacter: {"@type": "Person", name: "Elon Musk"}},
            });
            expect(crumbs?.itemListElement).toEqual([
                {"@type": "ListItem", position: 1, name: "Table", item: `${ORIGIN}/`},
                {"@type": "ListItem", position: 2, name: "Elon Musk", item: `${ORIGIN}/club/musk`},
                {"@type": "ListItem", position: 3, name: match.headline.text},
            ]);
            expect(JSON.stringify(jsonLd(page))).not.toContain("ClaimReview");
        });

        it("cuts a match description at a word boundary to fit search results", async () => {
            const {pages} = makePages([match]);

            const page = await html(pages.getMatch(match.id, ORIGIN));
            const text = ofType(page, "Article")?.description as string;

            expect(text.length).toBeLessThanOrEqual(160);
            expect(text.endsWith("…")).toBe(true);
            expect(`${match.quote} `.replace(/\s+/g, " ")).toContain(`${text.slice(text.indexOf("“") + 1, -1)} `);
            expect(text.startsWith("Elon Musk: He said")).toBe(true);
        });

        it("fills the tags per request, so a cached page serves every origin", async () => {
            const {pages, stored} = makePages([match]);
            const odd = "http://odd$$.example";

            await html(pages.getMatch(match.id, ORIGIN));
            const page = await html(pages.getMatch(match.id, odd));

            expect(stored()).toBe(1);
            expect(canonical(page)).toBe(`${odd}/match/${match.id}`);
            expect(ofType(page, "WebSite")?.url).toBe(`${odd}/`);
            expect(page).not.toContain(ORIGIN);
        });

        it("keeps a hostile origin inside its attributes and its JSON-LD", async () => {
            const {pages} = makePages([match]);
            const hostile = 'http://x"><script>alert(1)</script>.example';

            const page = await html(pages.getMatch(match.id, hostile));
            const head = page.slice(0, page.indexOf("</head>"));

            expect(head.match(/<script>/g)).toBeNull();
            expect(canonical(page)).toBe(`${esc(hostile)}/match/${match.id}`);
            expect(ofType(page, "WebSite")?.url).toBe(`${hostile}/`);
            expect(ofType(page, "Article")?.mainEntityOfPage).toBe(`${hostile}/match/${match.id}`);
            for (const [, body] of head.matchAll(LD)) expect(body).not.toContain("<");
        });

        it("describes the race, honours and rules pages, naming a season's", async () => {
            const {pages} = makePages();

            expect(description(await html(pages.getRace({season: undefined}, ORIGIN)))).toBe(
                "The race on the record: month by month, how the most powerful men in tech climbed the table on the pitchforks their own words raised."
            );
            expect(description(await html(pages.getRace({season: "25-26"}, ORIGIN)))).toContain(
                "The race in Season 25/26: month by month"
            );
            expect(description(await html(pages.getHonours({season: undefined}, ORIGIN)))).toBe(
                "All-time honours: Marie Antoinette of the Year, The Control Group, Award, the award for every count and the roll of honour."
            );
            expect(description(await html(pages.getHonours({season: "25-26"}, ORIGIN)))).toContain(
                "Season 25/26 honours: "
            );
            expect(description(await html(pages.getRules(ORIGIN)))).toBe(
                "The laws of the game: how a statement is scored in pitchforks, how the table and the seasons work, who is eligible, the honours and the photo credits."
            );
        });

        it("describes a club page by its contender's place and pitchforks", async () => {
            const {pages} = makePages([makeStatement(), match]);

            expect(description(await html(pages.getClub({season: undefined}, "altman", ORIGIN)))).toBe(
                "Sam Altman (OpenAI): joint 1st all-time with 5 pitchforks from 1 match. Every statement word for word, with the backlash it raised and its sources."
            );
            expect(description(await html(pages.getClub({season: "25-26"}, "musk", ORIGIN)))).toMatch(
                /^Elon Musk \(xAI\): joint 1st in Season 25\/26 with 5 pitchforks from 1 match\. /
            );
            expect(description(await html(pages.getClub({season: "26-27"}, "musk", ORIGIN)))).toBe(
                "Elon Musk (xAI): no matches in Season 26/27. Every statement word for word, with the backlash it raised and its sources."
            );
        });

        it("marks a club page up as a page about its contender, with a breadcrumb", async () => {
            const photo: Photo = {
                file: "assets/ceos/altman.jpg",
                author: "A",
                licence: "CC BY 2.0",
                source: "https://commons.example/a",
                changes: "cropped",
            };
            const content = makeContent({
                ceos: [makeCeo({photo}), makeCeo({id: "musk", name: "Elon Musk", company: "xAI"})],
            });
            const {pages} = makePages([makeStatement()], content);

            const page = await html(pages.getClub({season: "25-26"}, "altman", ORIGIN));
            const crumbs = ofType(page, "BreadcrumbList");

            expect(ofType(page, "WebPage")).toEqual({
                "@context": "https://schema.org",
                "@type": "WebPage",
                url: `${ORIGIN}/25-26/club/altman`,
                mainEntity: {
                    "@type": "Person",
                    name: "Sam Altman",
                    worksFor: {"@type": "Organization", name: "OpenAI"},
                    image: `${ORIGIN}/assets/ceos/altman.jpg`,
                },
            });
            expect(crumbs?.itemListElement).toEqual([
                {"@type": "ListItem", position: 1, name: "Table", item: `${ORIGIN}/25-26`},
                {"@type": "ListItem", position: 2, name: "Sam Altman"},
            ]);
            expect(crumbs?.itemListElement.length).toBeGreaterThanOrEqual(2);
            expect(JSON.stringify(jsonLd(page))).not.toMatch(/ClaimReview|ProfilePage/);
        });

        it("leaves the image out for a contender without a photo, in every season", async () => {
            const {pages} = makePages();

            for (const season of [undefined, "25-26", "26-27"]) {
                const person = ofType(await html(pages.getClub({season}, "musk", ORIGIN)), "WebPage")?.mainEntity;
                expect(person).toEqual({
                    "@type": "Person",
                    name: "Elon Musk",
                    worksFor: {"@type": "Organization", name: "xAI"},
                });
            }
        });

        it("keeps a hostile name and company inside the description and the JSON-LD", async () => {
            const name = 'Bobby "</script><!--" Tables & Co';
            const company = "<b>Acme</b> & 'Sons'";
            const content = makeContent({ceos: [makeCeo({name, company})]});
            const {pages} = makePages([makeStatement()], content);

            const page = await html(pages.getClub({season: undefined}, "altman", ORIGIN));
            const head = page.slice(0, page.indexOf("</head>"));

            expect(head.match(/<script>|<b>/g)).toBeNull();
            for (const [, body] of head.matchAll(LD)) expect(body).not.toContain("<");
            expect(description(page)).toContain(
                esc(`${name} (${company}): 1st all-time with 5 pitchforks from 1 match.`)
            );
            expect(description(page)?.endsWith("…")).toBe(true);
            expect(ofType(page, "WebPage")?.mainEntity).toMatchObject({name, worksFor: {name: company}});
            expect(ofType(page, "BreadcrumbList")?.itemListElement[1].name).toBe(name);
        });

        it("leaves a missing match a 404 with no page", async () => {
            const {pages, stored} = makePages();

            expect(await pages.getMatch("hidden", ORIGIN)).toEqual(failure(AppError.NOT_FOUND));
            expect(stored()).toBe(0);
            const page = await pages.getNotFound();
            expect(page).not.toContain("canonical");
            expect(page).not.toContain("ld+json");
            expect(page).not.toContain("<!--preview-->");
        });
    });
});
