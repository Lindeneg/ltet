import {describe, expect, it} from "vitest";
import {RaceView} from "../../../src/ui/views/site/race.js";
import {HonoursView} from "../../../src/ui/views/site/honours.js";
import {RulesView} from "../../../src/ui/views/site/rules.js";
import {ClubView} from "../../../src/ui/views/site/club.js";
import {makeCeo, makeContent, makeStatement} from "../helpers.js";
import {siteFor} from "./helpers.js";

const csp = (html: string) => {
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html).not.toMatch(/<script>/);
};

describe("RaceView", () => {
    it("follows the leader on load and loads the chart's script", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "race"});

        const html = RaceView({site, title: "t"});

        csp(html);
        expect(html).toContain('<script src="/race-chart.js" defer></script>');
        expect(html).toContain('data-follow="altman" aria-pressed="true"');
        expect(html).toContain('data-follow="musk" aria-pressed="false"');
        expect(html).toContain('data-race-chart data-active="altman"');
        expect(html).toContain("Season 25/26 · running pitchforks, month by month");
        expect(html).toContain("Season 25/26 runs from 1 August 2025 to 31 July 2026.");
    });

    it("tells desktops to hover and phones to tap, each in its own span", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "race"});

        const html = RaceView({site, title: "t"});

        expect(html).toContain(
            '<span class="race-note-wide">Hover or tap the chart for every running total at the end of any month, and what that month added. With the chart focused, the arrow keys move through the season.</span>'
        );
        expect(html).toContain(
            '<span class="race-note-phone">Tap the chart for every running total at the end of any month, and what that month added. Tap a name under it to follow that line.</span>'
        );
    });

    it("lists the months on top with bars as width classes", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "race"});

        const html = RaceView({site, title: "t"});

        expect(html).toContain("Months top of the table, 25/26");
        expect(html).toContain('<span class="tm-bar" aria-hidden="true"><span class="w-1000"></span></span>');
        expect(html).toContain('<span class="tm-num">11 months</span>');
        expect(html).toContain('href="/25-26/club/altman" class="tm-name"');
    });

    it("tells all time from the record's opening", async () => {
        const site = await siteFor([makeStatement()], "all-time", {view: "race"});

        const html = RaceView({site, title: "t"});

        expect(html).toContain(
            "The record opened on 30 November 2022, the day ChatGPT launched; its first statement is from"
        );
        expect(html).toContain(">Months top of the table<");
    });

    it("says so when nobody has scored yet", async () => {
        const site = await siteFor([makeStatement()], "26-27", {view: "race"});

        const html = RaceView({site, title: "t"});

        expect(html).toContain("Nobody has topped the table yet this season.");
        expect(html).toContain(" No matches yet this season.");
    });
});

describe("HonoursView", () => {
    it("crowns a finished season's champion, awards and foot", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "honours"});

        const html = HonoursView({site, title: "t"});

        csp(html);
        expect(html).toContain("Season 25/26 · final");
        expect(html).toContain("Champion 25/26");
        expect(html).toContain("Won with 5 pitchforks from 1 match, 5 clear of Elon Musk");
        expect(html).toContain("0 pitchforks from 0 matches");
        expect(html).toContain('<span class="label">Best on the count: </span><a class="text-button" href="/match/');
        expect(html).toContain('data-report-list="altman-2025-09-01-statement"');
    });

    it("lists every season on the roll, the page's season selected", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "honours"});

        const html = HonoursView({site, title: "t"});

        expect(html.match(/<li class="roll-row/g)).toHaveLength(5);
        expect(html).toContain(
            '<li class="roll-row selected"><div class="roll-season"><a href="/25-26/honours">25/26</a>'
        );
        expect(html).toContain('<a href="/26-27/honours">26/27</a><span class="roll-state in-play">In progress</span>');
        expect(html).toContain('<span class="roll-none">No matches yet</span>');
        expect(html).toContain('<span class="roll-none">None yet</span>');
    });

    it("names all time's honours", async () => {
        const site = await siteFor([makeStatement()], "all-time", {view: "honours"});

        const html = HonoursView({site, title: "t"});

        expect(html).toContain("Awarded for distinguished service to public disapproval");
        expect(html).toContain("All-time honours");
        expect(html).toContain("The title");
        expect(html).toContain("for raising the most pitchforks of all");
    });
});

describe("RulesView", () => {
    const photo = {
        file: "assets/ceos/altman.jpg",
        author: "A <Photographer>",
        licence: "CC BY 4.0",
        licenceUrl: "https://creativecommons.example/by/4.0",
        source: "https://commons.example/altman",
        changes: "cropped",
    };

    it("indexes the laws as links, the first marked, and loads its script", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "rules"});

        const html = RulesView({site, title: "t", ceos: makeContent().ceos});

        csp(html);
        expect(html).toContain('<script src="/rules.js" defer></script>');
        expect(html).toContain('<a href="#law-scoring" data-law="scoring" aria-current="true">');
        expect(html).toContain('<a href="#law-credits" data-law="credits">');
        expect(html.match(/aria-current="true"/g)).toHaveLength(1);
        expect(html).toContain('id="law-honours-title"');
    });

    it("scores by the rubric and names the seasons", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "rules"});

        const html = RulesView({site, title: "t", ceos: makeContent().ceos});

        expect(html).toContain("It is judged on 2 counts, each scored 0 to 5 and weighted as shown.");
        expect(html).toContain('<span class="weight">× 2</span>');
        expect(html).toContain(
            "and they are the score. The table ranks contenders on their total, so every statement counts. The full table&#39;s Avg column gives the average per match. The reasons"
        );
        expect(html).toContain(
            "named by its two years: 25/26. The first, 22/23, opened with the record itself on 30 November 2022"
        );
    });

    it("lists what scores 0, 1, 3 and 5 under each count's question", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "rules"});

        const html = RulesView({site, title: "t", ceos: makeContent().ceos});

        expect(html).toContain(
            '<span class="lc-q">Doom?</span><dl class="lc-levels"><div><dt>0</dt><dd>Doom none</dd></div><div><dt>1</dt><dd>Doom a trace</dd></div><div><dt>3</dt><dd>Doom clear</dd></div><div><dt>5</dt><dd>Doom at worst</dd></div></dl>'
        );
    });

    it("says who the squad is, counted from the contenders, before the honours", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "rules"});
        const ceos = [
            makeCeo(),
            makeCeo({id: "musk", name: "Elon Musk"}),
            makeCeo({id: "huang", name: "Jensen Huang"}),
        ];

        const html = RulesView({site, title: "t", ceos});

        expect(html).toContain(
            '<a href="#law-squad" data-law="squad"><span class="law-n">Law 5</span><span>The squad</span></a>'
        );
        expect(html).toContain(
            "<p>The squad is the 3 contenders in the table: the people who run the companies building and selling the biggest AI models and platforms."
        );
        expect(html.indexOf('id="law-squad"')).toBeLessThan(html.indexOf('id="law-honours"'));
    });

    it("credits only the contenders with a photo, escaped", async () => {
        const site = await siteFor([makeStatement()], undefined, {view: "rules"});
        const ceos = [makeCeo({photo}), makeCeo({id: "musk", name: "Elon Musk"})];

        const html = RulesView({site, title: "t", ceos});

        expect(html.match(/<ul class="law-credits"><li>/g)).toHaveLength(1);
        expect(html).toContain("<strong>Sam Altman</strong>: A &lt;Photographer&gt;");
        expect(html).not.toContain("<strong>Elon Musk</strong>");
    });
});

describe("ClubView", () => {
    it("is null for a contender the league doesn't have", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "club", id: "nobody"});

        expect(ClubView({site, title: "t", id: "nobody"})).toBeNull();
    });

    it("shows his place, his seasons and his neighbours", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "club", id: "altman"});

        const html = ClubView({site, title: "t", id: "altman"})!;

        csp(html);
        expect(html).toContain('<h1 id="club-title" tabindex="-1">Sam Altman</h1>');
        expect(html).toContain('<span class="small">1st in 25/26</span>');
        expect(html).toContain("Marie Antoinette of the Year");
        expect(html).toContain('<span class="sr-only">Below him: </span>2 Musk');
        expect(html).toContain(
            '<tr class="selected"><th scope="row"><a href="/25-26/club/altman">25/26</a><span class="badge small zone-top">Champion</span>'
        );
        expect(html).toContain('<tfoot><tr><th scope="row"><a href="/club/altman">All-time</a>');
        expect(html).toContain('<span class="unit">months</span>');
    });

    it("leaves the photo credit to the rules page", async () => {
        const content = makeContent({
            ceos: [
                makeCeo({
                    photo: {
                        file: "assets/ceos/altman.jpg",
                        author: "A Photographer",
                        licence: "CC BY 4.0",
                        licenceUrl: "https://creativecommons.example/by/4.0",
                        source: "https://commons.example/altman",
                        changes: "cropped",
                    },
                }),
                makeCeo({id: "musk", name: "Elon Musk"}),
            ],
        });
        const site = await siteFor([makeStatement()], "25-26", {view: "club", id: "altman"}, content);

        const html = ClubView({site, title: "t", id: "altman"})!;

        expect(html).not.toContain("A Photographer");
        expect(html).not.toContain("Photo:");
    });

    it("bars his counts as width classes and lists his results", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "club", id: "altman"});

        const html = ClubView({site, title: "t", id: "altman"})!;

        expect(html).toContain('<span class="sr-bar" aria-hidden="true"><span class="w-1000"></span></span>');
        expect(html).toContain('<ol class="rows card" data-report-list="altman-2025-09-01-statement">');
        expect(html).toContain("Results in 25/26, 1 match");
    });

    it("draws the compact race, each line visiting its page", async () => {
        const site = await siteFor(
            [makeStatement(), makeStatement({id: "musk-2025-10-01", ceo: "musk", date: "2025-10-01"})],
            "25-26",
            {view: "club", id: "musk"}
        );

        const html = ClubView({site, title: "t", id: "musk"})!;

        expect(html).toContain('<script src="/race-chart.js" defer></script>');
        expect(html).toContain('class="race-chart compact" data-race-chart data-active="musk"');
        expect(html).toContain('data-id="altman" data-href="/25-26/club/altman"');
        expect(html).not.toContain("race-wide");
    });

    it("says so when he has no matches", async () => {
        const site = await siteFor([makeStatement()], "25-26", {view: "club", id: "musk"});

        const html = ClubView({site, title: "t", id: "musk"})!;

        expect(html).toContain("No matches in 25/26.");
        expect(html).toContain('<p class="empty card">No matches in 25/26.</p>');
    });
});
