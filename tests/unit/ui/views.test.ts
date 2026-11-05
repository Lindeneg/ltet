import {describe, expect, it} from "vitest";
import {TableView} from "../../../src/ui/views/site/table.js";
import {ResultsView, type ResultsFilters} from "../../../src/ui/views/site/results.js";
import {NotFoundView} from "../../../src/ui/views/site/not-found.js";
import {ServerErrorView} from "../../../src/ui/views/site/server-error.js";
import {makeStatement} from "../helpers.js";
import {siteFor} from "./helpers.js";

describe("TableView", () => {
    it("serves no inline style or event handler, which the csp would block", async () => {
        const site = await siteFor([makeStatement()]);

        const html = TableView({site, title: "t", preview: true});

        expect(html).not.toMatch(/\sstyle=/);
        expect(html).not.toMatch(/\son[a-z]+=/);
        expect(html).not.toMatch(/<script>/);
    });

    it("tells a finished season's champion and foot", async () => {
        const site = await siteFor([makeStatement()], "25-26");

        const html = TableView({site, title: "t"});

        expect(html).toContain("Season 25/26 · final table, 1 match");
        expect(html).toContain("Sam Altman won 25/26, 5 pitchforks clear.");
        expect(html).toContain("Elon Musk finished bottom on 0 pitchforks.");
        expect(html).toContain('<h2 class="section-title">Season honours</h2>');
        expect(html).toContain('href="/25-26/honours"');
    });

    it("tells the season in play so far", async () => {
        const site = await siteFor([makeStatement({date: "2026-09-01"})], "26-27");

        const html = TableView({site, title: "t"});

        expect(html).toContain("In progress: Sam Altman leads the table, 5 pitchforks clear.");
        expect(html).toContain("Elon Musk props up the table on 0 pitchforks so far.");
        expect(html).toContain("Leader so far");
        expect(html).toContain("Season honours so far");
        expect(html).toContain("at the season&#39;s end");
    });

    it("starts every contender level in a season without matches", async () => {
        const site = await siteFor([makeStatement()], "26-27");

        const html = TableView({site, title: "t"});

        expect(html).toContain("No matches yet this season. Every contender starts level.");
        expect(html).toContain("No honours yet: nobody has scored this season.");
    });

    it("shows movement while the season is live and has an earlier result day", async () => {
        const live = await siteFor(
            [makeStatement({date: "2026-09-01"}), makeStatement({id: "late", ceo: "musk", date: "2026-10-30"})],
            "26-27"
        );
        const oneDay = await siteFor([makeStatement({date: "2026-09-01"})], "26-27");
        const finished = await siteFor([makeStatement()], "25-26");

        const html = TableView({site: live, title: "t"});
        expect(html).toContain('class="move same"');
        expect(html).toContain('<span class="sr-only">Movement with the latest results, on 30 October</span>');
        expect(html).toContain("Places moved with the latest results, on 30 October");
        expect(TableView({site: oneDay, title: "t"})).toContain('class="league no-move"');
        expect(TableView({site: finished, title: "t"})).toContain('class="league no-move"');
    });

    it("folds the key into a disclosure and dots each count by its colour", async () => {
        const site = await siteFor([makeStatement()]);

        const html = TableView({site, title: "t"});

        expect(html).toContain(
            '<details class="table-key"><summary class="key-toggle">Key</summary><div class="key-lists">'
        );
        expect(html).not.toContain('<details class="table-key" open');
        expect(html).toMatch(/<td class="col-num col-cat c-[a-z-]+"><i class="dot" aria-hidden="true"><\/i>\d+<\/td>/);
    });

    it("leaves a slot for the front page's preview tags only when asked", async () => {
        const site = await siteFor([makeStatement()]);

        expect(TableView({site, title: "t", preview: true})).toContain("<!--preview-->");
        expect(TableView({site, title: "t"})).not.toContain("<!--preview-->");
    });

    it("marks the table tab and points every season at the table", async () => {
        const site = await siteFor([makeStatement()], "25-26");

        const html = TableView({site, title: "t"});

        expect(html).toContain(
            '<a href="/25-26" aria-current="page"><svg class="tab-icon" aria-hidden="true"><use href="#tab-table"/></svg><span class="tab-label">Table</span></a>'
        );
        expect(html).toContain(
            '<a href="/rules"><svg class="tab-icon" aria-hidden="true"><use href="#tab-rules"/></svg>'
        );
        expect(html).toContain(
            '<nav class="season-pick" aria-labelledby="season-pick-label"><a class="season-link" href="/" aria-label="All-time">All-time</a>'
        );
        expect(html).toContain('class="season-link current" href="/26-27"');
        expect(html).toContain('href="/25-26" aria-current="true"');
    });
});

describe("the per match column", () => {
    const busyAltman = [1, 2, 3, 4, 5].map((day) =>
        makeStatement({id: `altman-2025-09-0${day}-x`, date: `2025-09-0${day}`}, {loss: 1, doom: 1})
    );
    const sharpMusk = makeStatement({id: "musk-2025-09-06-x", ceo: "musk", date: "2025-09-06"}, {loss: 4, doom: 4});

    it("shows each contender's average after the points, while the table still ranks on the total", async () => {
        const site = await siteFor([...busyAltman, sharpMusk], "25-26");

        const html = TableView({site, title: "t"});

        expect(site.ctx.standings.map((row) => row.ceo.id)).toEqual(["altman", "musk"]);
        expect(html).toContain('<td class="col-num col-pts">15</td><td class="col-num col-avg">3.0</td>');
        expect(html).toContain('<td class="col-num col-pts">12</td><td class="col-num col-avg">12.0</td>');
        expect(html.indexOf("Sam Altman</span>")).toBeLessThan(html.indexOf("Elon Musk</span>"));
        expect(html).toContain(
            '<th scope="col" class="col-num col-pts"><abbr title="Points: pitchforks">Pts</abbr></th><th scope="col" class="col-num col-avg"><abbr title="pitchforks per match">Avg</abbr></th>'
        );
    });

    it("keys the column and gives a contender with no matches a plain zero", async () => {
        const site = await siteFor([makeStatement()], "25-26");

        const html = TableView({site, title: "t"});

        expect(html).toContain('<li><abbr title="Average">Avg</abbr> pitchforks per match</li>');
        expect(html).toContain('<td class="col-num col-pts">0</td><td class="col-num col-avg">0</td>');
    });
});

describe("phone navigation", () => {
    it("keeps one league nav and marks the table as a club page's parent", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "club", id: "altman"});

        const html = TableView({site, title: "t"});

        expect(html.match(/aria-label="League"/g)).toHaveLength(1);
        expect(html).toContain('<a href="/" class="parent"><svg class="tab-icon"');
    });

    it("folds the seasons into a menu that names the season it shows", async () => {
        const site = await siteFor([makeStatement()], "25-26");

        const html = TableView({site, title: "t"});

        expect(html).toContain(
            '<summary class="season-menu-button"><span class="season-menu-name" aria-hidden="true">25/26</span><span class="sr-only">Season 25/26</span>'
        );
        expect(html).toContain(
            '<nav class="season-menu-list" aria-label="Season"><a class="season-menu-link" href="/" aria-label="All-time">All-time</a>'
        );
        expect(html).toContain('class="season-menu-link current" href="/26-27"');
        expect(html).toContain('<span class="season-state"><span class="live final">');
    });

    it("puts the live dot on the menu's button for the current season", async () => {
        const site = await siteFor([makeStatement()], "26-27");

        const html = TableView({site, title: "t"});

        expect(html).toContain('<summary class="season-menu-button"><span class="live-dot" aria-hidden="true"></span>');
        expect(html).toContain('<span class="season-state"><span class="live">');
    });
});

describe("error views", () => {
    it("hide the season picker", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "error"});

        expect(NotFoundView(site)).not.toContain('class="seasonbar"');
        expect(NotFoundView(site)).not.toContain('class="season-menu"');
        expect(ServerErrorView()).not.toContain('class="seasonbar"');
    });
});

describe("ResultsView", () => {
    const statements = () => [
        makeStatement(),
        makeStatement({id: "musk-2025-10-01-x", ceo: "musk", date: "2025-10-01"}, {loss: 1, doom: 4}),
    ];
    const view = async (filters: Partial<ResultsFilters> = {}) => {
        const site = await siteFor(statements(), "25-26", {view: "results"});
        return ResultsView({site, title: "t", filters: {ceo: undefined, count: undefined, sort: "newest", ...filters}});
    };

    it("links every filter at its canonical address", async () => {
        const html = await view({count: "doom", sort: "pitchforks"});

        expect(html).toContain('class="pick" href="/25-26/results?ceo=musk&amp;count=doom&amp;sort=pitchforks"');
        expect(html).toContain('class="pick" href="/25-26/results?count=doom&amp;sort=pitchforks" aria-current="true"');
        expect(html).toContain('class="chip c-doom" href="/25-26/results?sort=pitchforks" aria-current="true"');
        expect(html).toContain('<input type="hidden" name="count" value="doom">');
        expect(html).toContain('<option value="pitchforks" selected>Most pitchforks</option>');
    });

    it("groups by month newest first, or ranks by pitchforks", async () => {
        const byMonth = await view();
        const ranked = await view({sort: "pitchforks"});

        expect(byMonth.indexOf("October 2025")).toBeLessThan(byMonth.indexOf("September 2025"));
        expect(ranked).toContain('<span class="m-rank">#1</span>');
        expect(ranked).toContain('data-report-list="musk-2025-10-01-x altman-2025-09-01-statement"');
    });

    it("counts what each filter would show and what is shown", async () => {
        const html = await view({ceo: "musk"});

        expect(html).toContain("1 match of 2 in 25/26");
        expect(html).toContain('aria-label="Elon Musk, 1 match"');
    });

    it("folds the filters behind a bar that names the current choice", async () => {
        const plain = await view();
        const picked = await view({ceo: "musk", count: "doom"});

        expect(plain).toContain('<details class="filter-fold">');
        expect(plain).toContain('<span class="filter-bar-choice">Everyone · Any count</span>');
        expect(picked).toContain('<span class="filter-bar-choice">Musk · Doom</span>');
    });

    it("offers Show more only past 20 cards, and loads its script", async () => {
        const few = await view();
        const site = await siteFor(
            Array.from({length: 21}, (_, i) =>
                makeStatement({id: `altman-2025-09-${i + 1}-x`, date: `2025-09-${String(i + 1).padStart(2, "0")}`})
            ),
            "25-26",
            {view: "results"}
        );
        const many = ResultsView({site, title: "t", filters: {ceo: undefined, count: undefined, sort: "newest"}});

        expect(few).not.toContain("data-more");
        expect(many).toContain('<div class="more" data-more="20" hidden>');
        expect(many).toContain('<button type="button" class="button">Show more</button>');
        expect(few).toContain('<script src="/results.js" defer></script>');
    });

    it("offers to clear filters that show nothing, keeping the order", async () => {
        const html = await view({ceo: "altman", count: "doom", sort: "oldest"});

        expect(html).toContain("No matches on these filters. A quiet month, perhaps.");
        expect(html).toContain('<a class="button" href="/25-26/results?sort=oldest">Clear the filters</a>');
    });

    it("hides the next fixture once the season is over, and serves no inline style", async () => {
        const html = await view();

        expect(html).toContain('<p class="next-fixture" hidden>');
        expect(html).not.toMatch(/\sstyle=/);
        expect(html).not.toMatch(/\son[a-z]+=/);
    });
});

describe("the dialogs in the layout", () => {
    it("carry every statement in date order and every contender for the foul report", async () => {
        const site = await siteFor([makeStatement({id: "b", date: "2025-10-01"}), makeStatement({id: "a"})], "26-27");

        const html = TableView({site, title: "t"});

        expect(html).toContain(
            '<dialog id="report" class="report" aria-labelledby="d-report-headline" data-champions="" data-club-path="/26-27/club/" data-report-list="a b">'
        );
        expect(html).toContain('<option value="">Not sure</option><option value="altman">Sam Altman</option>');
        expect(html).toContain('maxlength="1000"');
        expect(html).toContain('maxlength="500"');
    });
});

describe("the colophon", () => {
    it("links the referee's tip jar in a new tab on every site page", async () => {
        const site = await siteFor([makeStatement()]);
        const link =
            '<p class="donate-line"><a class="text-button" href="https://ko-fi.com/letthemeattokens" target="_blank" rel="noopener">Buy the referee a token</a></p>';

        expect(TableView({site, title: "t"})).toContain(link);
        expect(NotFoundView(site)).toContain(link);
        expect(ServerErrorView()).toContain(link);
    });
});
