export const FETCH_TIMEOUT_MS = 20_000;
export const MIN_FRAGMENT_WORDS = 4;
const MAX_PAGE_BYTES = 5_000_000;
export const USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ENTITIES: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
    mdash: " ",
    ndash: " ",
    hellip: "...",
};

export type Page = {ok: boolean; status: number | string; text: string};

export type Verdict = "found" | "partial" | "absent" | "unreadable" | "too short";

export type QuoteMatch = {verdict: Verdict; found: number; of: number; status?: number | string};

export function normalize(text: string): string {
    return text
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
        .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .toLowerCase()
        .replace(/[‘’ʼ']/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

// a quote may be trimmed with ... and carry editorial insertions in brackets
export function quoteFragments(quote: string): string[] {
    return quote
        .split(/\.\.\.|…|\[[^\]]*\]/)
        .map(normalize)
        .filter((fragment) => fragment.split(" ").length >= MIN_FRAGMENT_WORDS);
}

export async function fetchText(url: string): Promise<Page> {
    try {
        const response = await fetch(url, {
            headers: {"user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*"},
            redirect: "follow",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return {ok: false, status: response.status, text: ""};
        const text = await response.text();
        return {ok: true, status: response.status, text: text.slice(0, MAX_PAGE_BYTES)};
    } catch (error) {
        const err = error as Error;
        return {ok: false, status: err.name === "TimeoutError" ? "timeout" : err.message, text: ""};
    }
}

export function matchQuote(quote: string, page: Page): QuoteMatch {
    const fragments = quoteFragments(quote);
    if (fragments.length === 0) return {verdict: "too short", found: 0, of: 0};
    if (!page.ok) return {verdict: "unreadable", found: 0, of: fragments.length, status: page.status};
    const text = normalize(page.text);
    const found = fragments.filter((fragment) => text.includes(fragment)).length;
    const verdict = found === fragments.length ? "found" : found > 0 ? "partial" : "absent";
    return {verdict, found, of: fragments.length};
}

export function headlineOnPage(headline: string, page: Page): boolean {
    return page.ok && normalize(page.text).includes(normalize(headline));
}
