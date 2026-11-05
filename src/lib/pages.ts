import {fetchText, type Page} from "./quote-check.js";

const EXCERPT_BEFORE = 600;
const EXCERPT_AFTER = 2_400;
const MIN_HINT_WORD = 4;

const ENTITIES: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    mdash: "—",
    ndash: "–",
    hellip: "…",
};

export type PageLoader = (url: string) => Promise<Page>;

function decode(text: string): string {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

export function pageText(html: string): string {
    return decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

export function pageTitles(html: string): string[] {
    const pick = (pattern: RegExp) =>
        decode(html.match(pattern)?.[1] ?? "")
            .replace(/\s+/g, " ")
            .trim();
    return [
        pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ||
            pick(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i),
        pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, ""),
    ].filter((title, i, all) => title && all.indexOf(title) === i);
}

export function excerpt(text: string, hint: string): string {
    const words = new Set(
        hint
            .toLowerCase()
            .match(/[\p{L}\p{N}']+/gu)
            ?.filter((w) => w.length >= MIN_HINT_WORD) ?? []
    );
    const positions: number[] = [];
    for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}']+/gu)) {
        if (words.has(match[0])) positions.push(match.index);
    }
    if (positions.length === 0) return text.slice(0, EXCERPT_BEFORE + EXCERPT_AFTER);
    let best = 0;
    let bestCount = 0;
    for (let i = 0, j = 0; i < positions.length; i += 1) {
        while (j < positions.length && positions[j] - positions[i] <= EXCERPT_AFTER) j += 1;
        if (j - i > bestCount) {
            bestCount = j - i;
            best = positions[i];
        }
    }
    const start = Math.max(0, best - EXCERPT_BEFORE);
    return text.slice(start, best + EXCERPT_AFTER);
}

export function pageCache(fetchPage: PageLoader = fetchText): PageLoader {
    const pages = new Map<string, Promise<Page>>();
    return (url) => {
        let page = pages.get(url);
        if (!page) {
            page = fetchPage(url);
            pages.set(url, page);
        }
        return page;
    };
}
