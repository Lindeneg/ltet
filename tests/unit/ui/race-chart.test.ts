import {describe, expect, it} from "vitest";
import {tally} from "../../../src/lib/score.js";
import {buildSnapshots} from "../../../src/lib/snapshots.js";
import {layoutRace, monthTitle, niceScale, RaceChart, spreadLabels} from "../../../src/ui/components/race-chart.js";
import {makeContent, makeStatement} from "../helpers.js";

const SEASON = {from: Date.UTC(2025, 7, 1), to: Date.UTC(2025, 9, 15)};
const CONTENDERS = [
    {id: "altman", shortName: "Altman"},
    {id: "musk", shortName: "Musk"},
];

function makeSnapshots(statements = [makeStatement()], span = SEASON) {
    const {ceos, rubric} = makeContent();
    return buildSnapshots(tally(ceos, rubric, statements).standings, span);
}

describe("niceScale", () => {
    it("keeps the axis at five steps or fewer of a nice size", () => {
        expect(niceScale(10)).toEqual({top: 10, step: 2.5});
        expect(niceScale(37)).toEqual({top: 40, step: 10});
        expect(niceScale(120)).toEqual({top: 150, step: 50});
        expect(niceScale(0)).toEqual({top: 0.25, step: 0.25});
    });
});

describe("spreadLabels", () => {
    it("pushes overlapping labels apart by the gap", () => {
        const spread = spreadLabels([{y: 50}, {y: 52}, {y: 100}], 0, 300, 17);

        expect(spread.map((l) => l.y)).toEqual([50, 67, 100]);
    });

    it("pulls labels back up when the last one runs past the bottom", () => {
        const spread = spreadLabels([{y: 290}, {y: 295}], 0, 300, 17);

        expect(spread.map((l) => l.y)).toEqual([283, 300]);
    });

    it("never moves a label above the top", () => {
        const spread = spreadLabels([{y: 2}, {y: 3}, {y: 4}], 8, 20, 17);

        expect(spread.every((l) => l.y >= 8)).toBe(true);
    });

    it("leaves the labels it was given alone", () => {
        const labels = [{y: 10}, {y: 11}];

        spreadLabels(labels, 0, 300, 17);

        expect(labels).toEqual([{y: 10}, {y: 11}]);
    });
});

describe("layoutRace", () => {
    it("draws a step line only for a contender with pitchforks, rising from zero in the month that added them", () => {
        const layout = layoutRace(makeSnapshots(), CONTENDERS, "wide");

        expect(layout.series.map((s) => s.id)).toEqual(["altman"]);
        const [altman] = layout.series;
        expect(altman.total).toBe(5);
        expect(altman.added).toEqual([{cx: 50, cy: 164}]);
        expect(altman.segments).toEqual([
            {x1: 0, y1: 314, x2: 50, y2: 314},
            {x1: 50, y1: 314, x2: 50, y2: 164},
            {x1: 50, y1: 164, x2: 100, y2: 164},
        ]);
    });

    it("holds a line through months that added nothing and jumps in the next that did", () => {
        const statements = [makeStatement({date: "2025-08-02"}), makeStatement({id: "b", date: "2025-10-02"})];

        const [altman] = layoutRace(makeSnapshots(statements), CONTENDERS, "wide").series;

        expect(altman.segments).toEqual([
            {x1: 0, y1: 314, x2: 0, y2: 164},
            {x1: 0, y1: 164, x2: 100, y2: 164},
            {x1: 100, y1: 164, x2: 100, y2: 14},
        ]);
    });

    it("scales the axis to at least ten and gives the bottom of the plot zero", () => {
        const layout = layoutRace(makeSnapshots(), CONTENDERS, "wide");

        expect(layout.grid.map((g) => g.value)).toEqual([0, 2.5, 5, 7.5, 10]);
        expect(layout.grid[0].y).toBe(layout.plotBottom);
        expect(layout.grid.at(-1)!.y).toBe(layout.plotTop);
    });

    it("labels every month with the first carrying its year on a wide chart", () => {
        const layout = layoutRace(makeSnapshots(), CONTENDERS, "wide");

        expect(layout.months.map((m) => m.text)).toEqual(["Aug 2025", "Sep", "Oct"]);
    });

    it("labels every third month without a year on a narrow chart", () => {
        const span = {from: Date.UTC(2025, 7, 1), to: Date.UTC(2026, 6, 31)};

        const layout = layoutRace(makeSnapshots([makeStatement()], span), CONTENDERS, "narrow");

        expect(layout.months.map((m) => m.text)).toEqual(["Aug", "Nov", "Feb", "May"]);
    });

    it("labels years on a span longer than fourteen months", () => {
        const span = {from: Date.UTC(2022, 10, 30), to: Date.UTC(2025, 1, 1)};

        const layout = layoutRace(makeSnapshots([makeStatement()], span), CONTENDERS, "wide");

        expect(layout.months.map((m) => [m.text, m.anchor])).toEqual([
            ["2022", "start"],
            ["2023", "middle"],
            ["2024", "middle"],
            ["2025", "middle"],
        ]);
    });

    it("gives the labels less room and the plot less height when narrow", () => {
        const span = {from: Date.UTC(2022, 10, 30), to: Date.UTC(2026, 10, 1)};
        const snapshots = makeSnapshots([makeStatement()], span);

        const wide = layoutRace(snapshots, CONTENDERS, "wide");
        const narrow = layoutRace(snapshots, CONTENDERS, "narrow");

        expect([wide.labelRoom, wide.height]).toEqual([150, 14 + 300 + 34]);
        expect([narrow.labelRoom, narrow.height]).toEqual([116, 14 + 260 + 34]);
    });

    it("gives every January a short year when narrow or compact, and none when wide", () => {
        const span = {from: Date.UTC(2022, 10, 30), to: Date.UTC(2025, 1, 1)};
        const snapshots = makeSnapshots([makeStatement()], span);

        const shorts = (band: "wide" | "narrow" | "compact") =>
            layoutRace(snapshots, CONTENDERS, band).months.map((m) => m.short);

        expect(shorts("narrow")).toEqual([undefined, "’23", "’24", "’25"]);
        expect(shorts("compact")).toEqual([undefined, "’23", "’24", "’25"]);
        expect(shorts("wide")).toEqual([undefined, undefined, undefined, undefined]);
    });

    it("keeps end labels apart when two totals finish close together", () => {
        const statements = [makeStatement(), makeStatement({id: "musk-2025-09-02-statement", ceo: "musk"})];

        const layout = layoutRace(makeSnapshots(statements), CONTENDERS, "compact");

        const [a, b] = layout.series.map((s) => s.label!.y);
        expect(Math.abs(a - b)).toBeGreaterThanOrEqual(16);
        expect(layout.height).toBe(14 + 180 + 34);
        expect(layout.dotRadius).toBe(3);
    });

    it("centres a single month", () => {
        const span = {from: Date.UTC(2025, 7, 1), to: Date.UTC(2025, 7, 20)};

        const layout = layoutRace(makeSnapshots([makeStatement({date: "2025-08-02"})], span), CONTENDERS, "wide");

        expect(layout.months.map((m) => m.x)).toEqual([50]);
    });
});

describe("monthTitle", () => {
    it("names a finished month by its end and the month in play as so far", () => {
        const [august, september] = makeSnapshots([makeStatement()], {
            from: Date.UTC(2025, 7, 1),
            to: Date.UTC(2025, 8, 10),
        });

        expect(monthTitle(august)).toBe("End of August 2025");
        expect(monthTitle(september)).toBe("September 2025, so far");
    });
});

describe("RaceChart", () => {
    const render = (overrides = {}) =>
        RaceChart({
            snapshots: makeSnapshots(),
            contenders: CONTENDERS,
            activeId: "altman",
            label: "The race",
            rankLabel: "Follow",
            ...overrides,
        });

    it("draws a wide and a narrow chart, or only the compact one", () => {
        expect(render().match(/race-(wide|narrow|compact)\b/g)).toEqual(["race-wide", "race-narrow"]);
        expect(render({compact: true}).match(/race-(wide|narrow|compact)\b/g)).toEqual(["race-compact"]);
    });

    it("sets x in percent and never a viewBox or an inline style", () => {
        const html = render();

        expect(html).not.toContain("viewBox");
        expect(html).not.toContain("style=");
        expect(html).toContain(`<line x1="50%" y1="314" x2="50%" y2="164"></line>`);
    });

    it("marks the active line and links every line when it visits pages", () => {
        const html = render({hrefFor: (id: string) => `/club/${id}`});

        expect(html).toContain(`class="series active" data-id="altman" data-href="/club/altman"`);
    });

    it("draws a long and a short label for each year only where a short one exists", () => {
        const snapshots = makeSnapshots([makeStatement()], {from: Date.UTC(2022, 10, 30), to: Date.UTC(2025, 1, 1)});

        const html = render({snapshots, compact: true});

        expect(html).toContain(`<text class="long" x="0%" y="218" text-anchor="start">2022</text>`);
        expect(html.match(/<text class="short"[^>]*>[^<]*/g)!.map((t) => t.split(">")[1])).toEqual([
            "’23",
            "’24",
            "’25",
        ]);
        expect(render()).not.toContain(`class="long"`);
    });

    it("lists every contender with his running total as follow buttons", () => {
        const html = render();

        expect(html).toContain(`<p class="field-label race-rank-label" id="race-rank-label">Follow</p>`);
        expect(html).toContain(`<ol class="race-rank" aria-labelledby="race-rank-label">`);
        expect(html).toContain(
            `<button type="button" data-follow="altman" aria-pressed="true"><span class="rank-name">Altman</span><span class="rank-total">5</span></button>`
        );
        expect(html).toContain(
            `data-follow="musk" aria-pressed="false"><span class="rank-name">Musk</span><span class="rank-total">0</span>`
        );
    });

    it("lists every contender as a link to his page when it visits pages, marking the active one", () => {
        const html = render({hrefFor: (id: string) => `/club/${id}`, rankLabel: "Contenders"});

        expect(html).toContain(`<ol class="race-rank" aria-label="Contenders">`);
        expect(html).toContain(`<a href="/club/altman" aria-current="page"><span class="rank-name">Altman</span>`);
        expect(html).toContain(`<a href="/club/musk"><span class="rank-name">Musk</span>`);
        expect(html).not.toContain("data-follow");
    });

    it("escapes names and the label, and keeps the month data from closing its script", () => {
        const html = render({
            contenders: [{id: "altman", shortName: "<b>Sam</b>"}],
            label: `"quoted"`,
        });

        expect(html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
        expect(html).toContain(`aria-label="&quot;quoted&quot;"`);
        expect(html).not.toContain("<b>");
        const data = html.match(/<script type="application\/json" class="race-data">(.*?)<\/script>/s)![1];
        expect(JSON.parse(data)[1].rows[0]).toEqual({id: "altman", pos: "1", name: "<b>Sam</b>", total: 5, added: 5});
    });
});
