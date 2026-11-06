import {JSDOM} from "jsdom";
import {beforeAll, describe, expect, it} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {seasonKey, seasonStartYear} from "../../src/lib/seasons.js";
import {get, type TestResponse} from "./helpers.js";

const GENERIC_LINK_TEXT = new Set([
    "click here",
    "click this",
    "go",
    "here",
    "information",
    "learn more",
    "more",
    "more info",
    "more information",
    "right here",
    "read more",
    "see more",
    "start",
    "this",
]);

const FETCH_BATCH = 8;

const sitemap = await get("/sitemap.xml");
const locs = new Map(
    [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => {
        const url = new URL(loc);
        return [url.pathname + url.search, loc];
    })
);
const paths = [...locs.keys()];
if (sitemap.status !== 200 || paths.length === 0) {
    throw new Error(`/sitemap.xml answered ${sitemap.status} with ${paths.length} urls`);
}
const pages = new Map<string, PageFacts>();

type PageFacts = {
    status: number;
    robotsHeader: string | null;
    robots: string[];
    lang: string;
    title: string;
    h1s: string[];
    description: string;
    canonicals: string[];
    jsonLd: string[];
    imagesWithoutAlt: string[];
    unnamedLinks: string[];
    genericLinks: string[];
    scriptLinks: string[];
};

function linkName(link: HTMLAnchorElement): string {
    const labelledBy = link.getAttribute("aria-labelledby");
    const labelled = labelledBy
        ?.split(/\s+/)
        .map((id) => link.ownerDocument.getElementById(id)?.textContent ?? "")
        .join(" ");
    const alts = [...link.querySelectorAll("img[alt]")].map((img) => img.getAttribute("alt")).join(" ");
    return (
        [link.getAttribute("aria-label"), labelled, link.textContent, alts].map((name) => name?.trim()).find(Boolean) ??
        ""
    );
}

function factsOf(res: TestResponse): PageFacts {
    const {window} = new JSDOM(res.html);
    const doc = window.document;
    const attrs = (selector: string, name: string) =>
        [...doc.querySelectorAll(selector)].map((el) => el.getAttribute(name) ?? "");
    const links = [...doc.querySelectorAll<HTMLAnchorElement>("a[href]")];
    const linksWhere = (test: (link: HTMLAnchorElement) => boolean) => links.filter(test).map((l) => l.outerHTML);
    const facts = {
        status: res.status,
        robotsHeader: res.headers.get("x-robots-tag"),
        robots: attrs('meta[name="robots"]', "content"),
        lang: doc.documentElement.getAttribute("lang") ?? "",
        title: doc.title.trim(),
        h1s: [...doc.querySelectorAll("h1")].map((h1) => (h1.textContent ?? "").trim()),
        description: (doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "").trim(),
        canonicals: attrs('link[rel="canonical"]', "href"),
        jsonLd: [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ""),
        imagesWithoutAlt: [...doc.querySelectorAll("img:not([alt])")].map((img) => img.outerHTML),
        unnamedLinks: linksWhere((link) => linkName(link) === ""),
        genericLinks: linksWhere((link) => GENERIC_LINK_TEXT.has(linkName(link).toLowerCase())),
        scriptLinks: linksWhere((link) => /^\s*javascript:/i.test(link.getAttribute("href")!)),
    };
    window.close();
    return facts;
}

describe("seo audit of every page in the sitemap", () => {
    beforeAll(
        async () => {
            for (let i = 0; i < paths.length; i += FETCH_BATCH) {
                const batch = paths.slice(i, i + FETCH_BATCH);
                const responses = await Promise.all(batch.map((path) => get(path)));
                batch.forEach((path, j) => pages.set(path, factsOf(responses[j])));
            }
        },
        Math.max(60000, paths.length * 500)
    );

    it("lists pages", () => {
        expect(paths.length).toBeGreaterThan(0);
    });

    it.each(paths)("%s answers 200 and is indexable", (path) => {
        const page = pages.get(path)!;

        expect(page.status).toBe(200);
        expect(page.robotsHeader).toBeNull();
        expect(page.robots.filter((content) => /noindex|none/i.test(content))).toEqual([]);
        expect(page.lang).toMatch(/^[a-z]{2}/);
    });

    it.each(paths)("%s has a title, one h1, a description and its own canonical", (path) => {
        const page = pages.get(path)!;

        expect(page.title).not.toBe("");
        expect(page.h1s).toHaveLength(1);
        expect(page.h1s[0]).not.toBe("");
        expect(page.description).not.toBe("");
        expect(page.canonicals).toEqual([locs.get(path)]);
    });

    it.each(paths)("%s has structured data that parses", (path) => {
        const {jsonLd} = pages.get(path)!;

        expect(jsonLd.length).toBeGreaterThan(0);
        for (const block of jsonLd) {
            const data = JSON.parse(block);
            expect(data["@context"]).toBe("https://schema.org");
            expect(typeof data["@type"]).toBe("string");
        }
    });

    it.each(paths)("%s gives every image alt text and every link a name and a crawlable href", (path) => {
        const page = pages.get(path)!;

        expect(page.imagesWithoutAlt).toEqual([]);
        expect(page.unnamedLinks).toEqual([]);
        expect(page.genericLinks).toEqual([]);
        expect(page.scriptLinks).toEqual([]);
    });

    it("gives every page its own title", () => {
        const byTitle = new Map<string, string[]>();
        for (const [path, {title}] of pages) byTitle.set(title, [...(byTitle.get(title) ?? []), path]);

        expect([...byTitle.entries()].filter(([, same]) => same.length > 1)).toEqual([]);
    });

    it("covers a club page from a season its contender had no statements in", async () => {
        const seed = await readSeed();
        const played = new Set(seed.map((st) => `${seasonKey(seasonStartYear(Date.parse(st.date)))}/${st.ceo}`));
        const quiet = paths.filter((path) => {
            const match = path.match(/^\/(\d{2}-\d{2})\/club\/([^/]+)$/);
            return match !== null && !played.has(`${match[1]}/${match[2]}`);
        });

        expect(quiet.length).toBeGreaterThan(0);
    });

    it.each(["/results?ceo=altman", "/results?count=doom", "/results?sort=pitchforks"])(
        "keeps the filtered results view %s out of the sitemap and the index",
        async (path) => {
            const filtered = await get(path);

            expect(paths).toContain("/results");
            expect(paths.some((listed) => listed.includes("?"))).toBe(false);
            expect(filtered.status).toBe(200);
            expect(filtered.html).toMatch(/<meta name="robots" content="noindex[^"]*">/);
        }
    );

    it("keeps the share page out of the sitemap and the index", async () => {
        const [first] = await readSeed();
        const share = await get(`/s/${first.id}`);

        expect(paths.some((path) => path.startsWith("/s/"))).toBe(false);
        expect(share.status).toBe(200);
        expect(share.html).toContain(`<meta name="robots" content="noindex">`);
    });
});
