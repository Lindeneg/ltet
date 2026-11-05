import {describe, expect, it, vi} from "vitest";
import {excerpt, pageCache, pageText, pageTitles} from "../../../src/lib/pages.js";

describe("pages", () => {
    it("reads a page's text with case and punctuation kept", () => {
        const html = `<html><script>x()</script><style>p{}</style><p>He said &ldquo;Hello&rdquo; &amp; left.</p>\n\n<svg>no</svg></html>`;

        expect(pageText(html)).toBe("He said “Hello” & left.");
    });

    it("reads a page's names for itself once each", () => {
        const html = `<title>Big news</title><meta property="og:title" content="Big news"><h1>The <em>big</em> news</h1>`;

        expect(pageTitles(html)).toEqual(["Big news", "The big news"]);
    });

    it("cuts the passage where the hint's words fall together", () => {
        const text = `${"filler ".repeat(1000)}robots dishes kitchen ${"tail ".repeat(1000)}`;

        const passage = excerpt(text, "the robots do dishes");

        expect(passage).toContain("robots dishes kitchen");
        expect(passage.length).toBeLessThanOrEqual(3000);
        expect(excerpt("short text", "nothing matches")).toBe("short text");
    });

    it("loads each page once", async () => {
        const fetchPage = vi.fn().mockResolvedValue({ok: true, status: 200, text: "x"});
        const load = pageCache(fetchPage);

        await Promise.all([load("https://a.example"), load("https://a.example"), load("https://b.example")]);

        expect(fetchPage).toHaveBeenCalledTimes(2);
    });
});
