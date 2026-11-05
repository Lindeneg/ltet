import {describe, expect, it} from "vitest";
import {headlineOnPage, matchQuote, normalize, quoteFragments, type Page} from "../../../src/lib/quote-check.js";

const page = (text: string): Page => ({ok: true, status: 200, text});

describe("quote check", () => {
    it("reduces text to lowercase words whatever the typography", () => {
        expect(normalize("<p>It’s &ldquo;the  END&rdquo; &#8212; isn&#x27;t it?</p><script>x()</script>")).toBe(
            "its the end isnt it"
        );
    });

    it("splits a quote at ellipses and editorial brackets and drops short fragments", () => {
        expect(quoteFragments("We will change the world ... and [the company] will make a lot of money … ok")).toEqual([
            "we will change the world",
            "will make a lot of money",
        ]);
    });

    it("finds a quote when every fragment is on the page", () => {
        const quote = "We will change the world ... will make a lot of money";

        expect(
            matchQuote(quote, page("<p>“We will change the world,” he said. They will make a lot of money.</p>"))
        ).toEqual({
            verdict: "found",
            found: 2,
            of: 2,
        });
        expect(matchQuote(quote, page("We will change the world, he said."))).toMatchObject({
            verdict: "partial",
            found: 1,
        });
        expect(matchQuote(quote, page("Nothing like it."))).toMatchObject({verdict: "absent", found: 0});
    });

    it("reports a page that did not load and a quote too short to prove", () => {
        expect(matchQuote("Long enough to be a fragment", {ok: false, status: 403, text: ""})).toEqual({
            verdict: "unreadable",
            found: 0,
            of: 1,
            status: 403,
        });
        expect(matchQuote("Too short", page("Too short"))).toEqual({verdict: "too short", found: 0, of: 0});
    });

    it("finds a headline on its page", () => {
        expect(headlineOnPage("Altman says “we’re fine”", page("<h1>Altman says &quot;were fine&quot;</h1>"))).toBe(
            true
        );
        expect(headlineOnPage("Altman says", {ok: false, status: 500, text: ""})).toBe(false);
    });
});
