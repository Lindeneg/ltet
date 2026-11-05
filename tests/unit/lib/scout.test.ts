import {describe, expect, it, vi} from "vitest";
import {tally} from "../../../src/lib/score.js";
import type {Page} from "../../../src/lib/quote-check.js";
import {
    daysBefore,
    formatCost,
    nearest,
    rubricLines,
    sameStatement,
    spread,
    uniqueId,
    verify,
} from "../../../src/lib/scout.js";
import {makeContent, makeStatement} from "../helpers.js";

const QUOTE = "These are the exact words that were said in public";
const page = (text: string, ok = true): Page => ({ok, status: ok ? 200 : 404, text});

describe("sameStatement", () => {
    it("finds the same quote from the same contender", () => {
        const a = makeStatement({id: "a", headline: {text: "x", outlet: "o", url: "https://a.example"}});
        const b = makeStatement({id: "b", quote: `Well. ${QUOTE}, he said.`, date: "2025-09-02"});

        expect(sameStatement(a, b)).toBe(true);
    });

    it("tells different quotes apart", () => {
        const a = makeStatement();
        const b = makeStatement({
            quote: "Something else entirely with no words shared at all here",
            date: "2025-09-02",
            headline: {text: "x", outlet: "o", url: "https://b.example"},
        });

        expect(sameStatement(a, b)).toBe(false);
    });

    it("takes the same day and headline as the same statement", () => {
        const a = makeStatement();
        const b = makeStatement({quote: "Quite different words were reported in this other article"});

        expect(sameStatement(a, b)).toBe(true);
    });

    it("never matches across contenders", () => {
        expect(sameStatement(makeStatement(), makeStatement({ceo: "musk"}))).toBe(false);
    });
});

describe("uniqueId", () => {
    it("makes a kebab case id and numbers it past the taken ones", () => {
        expect(uniqueId("Altman Dishes!", new Set())).toBe("altman-dishes");
        expect(uniqueId("altman-dishes", new Set(["altman-dishes", "altman-dishes-2"]))).toBe("altman-dishes-3");
        expect(uniqueId("!!!", new Set())).toBe("statement");
    });
});

describe("daysBefore", () => {
    it("counts back whole days", () => {
        expect(daysBefore("2026-11-01", 14)).toBe("2026-10-18");
        expect(daysBefore("2026-03-02T05:00:00.000Z", 3)).toBe("2026-02-27");
    });
});

describe("spread and nearest", () => {
    const content = makeContent();
    const statements = Array.from({length: 30}, (_, i) =>
        makeStatement(
            {id: `s${i}`, quote: i === 7 ? "robots washing dishes everywhere tomorrow" : `quote number ${i}`},
            {loss: i % 6, doom: 0}
        )
    );
    const scored = tally(content.ceos, content.rubric, statements).statements;

    it("spreads up to 16 examples from the lowest to the highest score", () => {
        const examples = spread(scored);

        expect(examples.length).toBeLessThanOrEqual(16);
        expect(examples[0].forks).toBe(0);
        expect(examples.at(-1)!.forks).toBe(5);
        expect(new Set(examples).size).toBe(examples.length);
    });

    it("puts the statements sharing the most long words first, four of them", () => {
        const near = nearest(scored, "the robots are washing dishes");

        expect(near).toHaveLength(4);
        expect(near[0].id).toBe("s7");
    });
});

describe("verify", () => {
    const statement = makeStatement({
        quoteSource: "https://www.one.example/a",
        headline: {text: "A headline", outlet: "One", url: "https://www.one.example/a"},
        sources: [
            {outlet: "One", title: "t", url: "https://one.example/other"},
            {outlet: "Two", title: "t", url: "https://two.example/b"},
        ],
    });

    it("counts the sites printing the quote and loads each page once", async () => {
        const pages: Record<string, Page> = {
            "https://www.one.example/a": page(`<h1>A headline</h1><p>${QUOTE}</p>`),
            "https://one.example/other": page(`<p>${QUOTE}</p>`),
            "https://two.example/b": page(`<p>${QUOTE}</p>`),
        };
        const load = vi.fn(async (url: string) => pages[url]);

        const checks = await verify(statement, load);

        expect(checks).toMatchObject({foundOn: 2, verified: true, headlineFound: true});
        expect(checks.quotePages.map((p) => p.verdict)).toEqual(["found", "found", "found"]);
    });

    it("is not verified on one site, and notes a page that failed or a missing headline", async () => {
        const pages: Record<string, Page> = {
            "https://www.one.example/a": page("<p>nothing here</p>"),
            "https://one.example/other": page(`<p>${QUOTE}</p>`),
            "https://two.example/b": page("", false),
        };

        const checks = await verify(statement, async (url) => pages[url]);

        expect(checks).toMatchObject({foundOn: 1, verified: false, headlineFound: false});
        expect(checks.quotePages.map((p) => p.verdict)).toEqual(["absent", "found", "unreadable"]);
    });
});

describe("rubricLines", () => {
    it("gives the scout each count's question and what scores 0, 1, 3 and 5", () => {
        const doom = makeContent().rubric.categories[1];

        expect(rubricLines(doom)).toBe(
            [
                "- `doom` Doom: Doom?",
                "  - 0: Doom none",
                "  - 1: Doom a trace",
                "  - 3: Doom clear",
                "  - 5: Doom at worst",
            ].join("\n")
        );
    });
});

describe("formatCost", () => {
    it("always shows dollars and two decimals", () => {
        expect(formatCost(0.3)).toBe("$0.30");
        expect(formatCost(0)).toBe("$0.00");
        expect(formatCost(1.234)).toBe("$1.23");
    });
});
