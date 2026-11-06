import {describe, expect, it} from "vitest";
import {crest, face, photoCredit} from "../../../src/ui/components/face.js";
import {formChips, matchCard, moveMark, splitBar} from "../../../src/ui/components/pieces.js";
import {Ticker} from "../../../src/ui/components/ticker.js";
import {ReportBody} from "../../../src/ui/components/report.js";
import {moveWords, seasonPath} from "../../../src/ui/site.js";
import {makeCeo, makeStatement} from "../helpers.js";
import {siteFor} from "./helpers.js";

describe("seasonPath", () => {
    it("leaves all time out and puts a season in front", () => {
        expect(seasonPath("all-time", "all-time", "table")).toBe("/");
        expect(seasonPath("all-time", "all-time", "results")).toBe("/results");
        expect(seasonPath("all-time", "all-time", "club", "altman")).toBe("/club/altman");
        expect(seasonPath("all-time", "26-27", "table")).toBe("/26-27");
        expect(seasonPath("all-time", "25-26", "club", "altman")).toBe("/25-26/club/altman");
    });
});

describe("moveWords", () => {
    const now = Date.UTC(2026, 10, 15, 12);

    it("names the latest result day without the year in the current year", () => {
        const words = moveWords(Date.UTC(2026, 9, 30), now);

        expect([words.mark(2), words.mark(-1), words.mark(0)]).toEqual([
            "Up 2 on 30 October",
            "Down 1 on 30 October",
            "No change on 30 October",
        ]);
        expect(words.key).toBe("Places moved with the latest results, on 30 October");
        expect(words.header).toBe("Movement with the latest results, on 30 October");
    });

    it("names the year when the latest result day is in another year", () => {
        const words = moveWords(Date.UTC(2025, 11, 30), now);

        expect(words.mark(1)).toBe("Up 1 on 30 December 2025");
        expect(words.key).toBe("Places moved with the latest results, on 30 December 2025");
        expect(words.header).toBe("Movement with the latest results, on 30 December 2025");
    });
});

describe("face", () => {
    const photo = {
        file: "assets/ceos/altman.jpg",
        author: "A",
        licence: "CC BY 2.0",
        source: "https://s",
        changes: "cropped",
    };

    it("shows the photo with the name as alt and the initials for the fallback", () => {
        const html = face(makeCeo({photo}), {size: "md", gold: true});

        expect(html).toContain('<span class="face md gold" data-initials="SA">');
        expect(html).toContain('alt="Sam Altman"');
        expect(html).toContain('width="44" height="50"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('aria-hidden="true"');
    });

    it("asks for the photo from the site's root, whatever the page's depth", () => {
        expect(face(makeCeo({photo}))).toContain('src="/assets/ceos/altman.jpg"');
        expect(face(makeCeo({photo: {...photo, file: "/assets/ceos/altman.jpg"}}))).toContain(
            'src="/assets/ceos/altman.jpg"'
        );
    });

    it("loads eagerly and is read out when asked", () => {
        const html = face(makeCeo({photo}), {eager: true, beside: false});

        expect(html).not.toContain("loading=");
        expect(html).not.toContain("aria-hidden");
    });

    it("is the initials crest without a photo", () => {
        expect(face(makeCeo(), {size: "xs"})).toBe(crest(makeCeo(), "face-crest xs"));
    });

    it("credits a photo with its licence linked", () => {
        expect(photoCredit({...photo, licenceUrl: "https://l"})).toBe(
            'A, <a href="https://l" target="_blank" rel="noopener">CC BY 2.0</a>, cropped, <a href="https://s" target="_blank" rel="noopener">source on Wikimedia Commons</a>'
        );
        expect(photoCredit({...photo, licence: "Public Domain"})).toContain("A, public domain, cropped");
    });

    it.each(["javascript:alert(1)", "data:text/html,x", "/wiki/File:A.jpg"])(
        "credits a photo as plain text where a url is %s",
        (url) => {
            expect(photoCredit({...photo, licenceUrl: url, source: url})).toBe(
                "A, CC BY 2.0, cropped, source on Wikimedia Commons"
            );
        }
    );
});

describe("splitBar", () => {
    it("sizes the fill and each count with width classes, never a style attribute", async () => {
        const site = await siteFor([makeStatement()]);

        const html = splitBar(site, {loss: 3, doom: 2}, 15);

        expect(html).toContain('class="split-fill w-333"');
        expect(html).toContain('class="seg c-loss w-600"');
        expect(html).toContain('class="seg c-doom w-400"');
        expect(html).toContain('aria-label="What you&#39;ll lose 3, Doom 2"');
        expect(html).not.toContain("style=");
    });

    it("leaves out a count with nothing on it", async () => {
        const site = await siteFor([makeStatement()]);

        expect(splitBar(site, {loss: 0, doom: 2}, 15)).not.toContain("c-loss");
    });
});

describe("formChips", () => {
    it("links his last five statements, with previous and next over all of his newest first", async () => {
        const dates = ["2025-08-02", "2025-08-03", "2025-08-04", "2025-08-05", "2025-08-06", "2025-08-07"];
        const site = await siteFor(
            dates.map((date) => makeStatement({id: `s-${date}`, date})),
            "25-26"
        );
        const row = site.ctx.rowById.get("altman")!;

        const html = formChips(site, row);

        expect(html.match(/class="fc /g)).toHaveLength(5);
        expect(html).not.toContain('href="/match/s-2025-08-02"');
        expect(html).toContain(
            `data-report-list="${dates
                .map((d) => `s-${d}`)
                .reverse()
                .join(" ")}"`
        );
    });

    it("says so when he has no matches", async () => {
        const site = await siteFor([makeStatement()], "25-26");

        expect(formChips(site, site.ctx.rowById.get("musk")!)).toBe('<span class="form-none">No matches</span>');
    });
});

describe("moveMark", () => {
    it("marks places moved with the latest results", async () => {
        const site = await siteFor([makeStatement(), makeStatement({id: "late", ceo: "musk", date: "2026-10-30"})]);

        expect(moveMark(site, 2)).toContain('<span class="move up" title="Up 2 on 30 October">');
        expect(moveMark(site, -1)).toContain("Down 1 on 30 October");
        expect(moveMark(site, 0)).toContain("No change on 30 October");
    });
});

describe("matchCard", () => {
    it("links the match report and escapes what the statement says", async () => {
        const st = makeStatement({headline: {text: "<b>Big</b>", outlet: "O", url: "https://o"}, leaked: true});
        const site = await siteFor([st], "25-26");

        const html = matchCard(site, site.ctx.statements[0], 3);

        expect(html).toContain(`href="/match/${st.id}" data-report="${st.id}"`);
        expect(html).toContain("&lt;b&gt;Big&lt;/b&gt;");
        expect(html).toContain('<span class="m-rank">#3</span>');
        expect(html).toContain('<span class="tag">Leaked</span>');
        expect(html).toContain("Number 3. Sam Altman 5 pitchforks, Mon 1 Sept 2025, leaked: &lt;b&gt;Big&lt;/b&gt;");
    });
});

describe("Ticker", () => {
    it("lists every result with a copy for the loop that is hidden and never focused", async () => {
        const site = await siteFor([makeStatement(), makeStatement({id: "second", date: "2025-10-01"})]);

        const html = Ticker(site.league.newest);

        expect(html).toContain('data-report-list="second altman-2025-09-01-statement"');
        expect(html.match(/data-report="/g)).toHaveLength(2);
        expect(html).toContain('<ol class="ticker-list copy" aria-hidden="true">');
        expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    });
});

describe("ReportBody", () => {
    it("shows the statement, its scores and its sources, escaped", async () => {
        const st = makeStatement({quote: "We <will> win", primarySource: {url: "https://p", kind: "video"}});
        const site = await siteFor([st], "25-26");

        const html = ReportBody(site, site.ctx.statements[0]);

        expect(html).toContain("“We &lt;will&gt; win”");
        expect(html).toContain("Sources (4)");
        expect(html).toContain('<span class="stat-score"><strong>1</strong>/5 × 2</span>');
        expect(html).toContain("<strong>5 pitchforks</strong><span>of a possible 15</span>");
        expect(html).toContain('href="/25-26/club/altman"');
        expect(html).toContain('data-var="altman-2025-09-01-statement"');
        expect(html).toContain(
            '<button type="button" role="tab" id="tab-stats" data-tab="stats" aria-controls="panel-stats" aria-selected="true" tabindex="0">'
        );
        expect(html).toContain('id="panel-report" data-tab="report" aria-labelledby="tab-report" tabindex="0" hidden');
    });

    it.each(["javascript:alert(1)", "data:text/html,x", "/elsewhere"])(
        "links no source whose url is %s, and shows its text",
        async (url) => {
            const st = makeStatement({
                headline: {text: "Big words", outlet: "Outlet", url},
                quoteSource: url,
                primarySource: {url, kind: "video"},
                backlash: {summary: "Uproar", url},
                sources: [{outlet: "Daily", title: "A story", url}],
            });
            const site = await siteFor([st], "25-26");

            const html = ReportBody(site, site.ctx.statements[0]);

            expect(html).not.toContain(url);
            expect(html).not.toContain('target="_blank"');
            expect(html).toContain("Big words");
            expect(html).toContain("See the reaction");
            expect(html).toContain('<span class="outlet">Daily</span>: A story');
        }
    );
});
