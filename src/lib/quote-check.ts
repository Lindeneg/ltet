import {lookup as dnsLookup} from "node:dns";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import {BlockList, isIP, type LookupFunction} from "node:net";
import type {Readable} from "node:stream";
import {createBrotliDecompress, createGunzip, createInflate} from "node:zlib";

export const FETCH_TIMEOUT_MS = 20_000;
export const MIN_FRAGMENT_WORDS = 4;
export const MAX_PAGE_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;
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

export type AddressCheck = (address: string) => boolean;

export type FetchOpts = {lookup?: typeof dnsLookup; isPublic?: AddressCheck};

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
] as const) {
    NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    return family !== 0 && !NON_PUBLIC.check(address, family === 6 ? "ipv6" : "ipv4");
}

class Refused extends Error {}

function guardedLookup(lookup: typeof dnsLookup, isPublic: AddressCheck): LookupFunction {
    return (hostname, options, callback) => {
        lookup(hostname, {...options, all: true}, (error, addresses) => {
            if (error) return callback(error, "", 0);
            const blocked = addresses.find((a) => !isPublic(a.address));
            if (blocked)
                return callback(new Refused(`${hostname} resolves to ${blocked.address}, not a public address`), "", 0);
            if (options.all) return callback(null, addresses);
            callback(null, addresses[0].address, addresses[0].family);
        });
    };
}

function refusal(url: URL, isPublic: AddressCheck): string | null {
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} is not http or https`;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublic(host)) return `${host} is not a public address`;
    return null;
}

type Hop = {status: number; location?: string; body?: Buffer};

function request(url: URL, lookup: LookupFunction, signal: AbortSignal): Promise<Hop> {
    return new Promise((resolve, reject) => {
        const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
            url,
            {
                headers: {
                    "user-agent": USER_AGENT,
                    accept: "text/html,application/xhtml+xml,*/*",
                    "accept-encoding": "gzip, deflate, br",
                },
                lookup,
                signal,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.resume();
                    return resolve({status, location: res.headers.location});
                }
                if (status < 200 || status >= 300) {
                    res.resume();
                    return resolve({status});
                }
                const encoding = res.headers["content-encoding"]?.trim().toLowerCase();
                const body: Readable =
                    encoding === "gzip" || encoding === "x-gzip"
                        ? res.pipe(createGunzip())
                        : encoding === "deflate"
                          ? res.pipe(createInflate())
                          : encoding === "br"
                            ? res.pipe(createBrotliDecompress())
                            : res;
                const chunks: Buffer[] = [];
                let size = 0;
                const done = () => {
                    res.destroy();
                    body.destroy();
                    resolve({status, body: Buffer.concat(chunks, size)});
                };
                body.on("data", (chunk: Buffer) => {
                    const room = MAX_PAGE_BYTES - size;
                    chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
                    size += Math.min(chunk.length, room);
                    if (size >= MAX_PAGE_BYTES) done();
                });
                body.on("end", done);
                body.on("error", reject);
                res.on("error", reject);
            }
        );
        req.on("error", reject);
        req.end();
    });
}

export function makeFetchText({lookup = dnsLookup, isPublic = isPublicAddress}: FetchOpts = {}) {
    const guarded = guardedLookup(lookup, isPublic);
    return async (address: string): Promise<Page> => {
        const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        try {
            let url = new URL(address);
            for (let hops = 0; ; hops += 1) {
                const refused = refusal(url, isPublic);
                if (refused) return {ok: false, status: `not fetched: ${refused}`, text: ""};
                const hop = await request(url, guarded, signal);
                if (hop.body) return {ok: true, status: hop.status, text: hop.body.toString("utf8")};
                if (!hop.location) return {ok: false, status: hop.status, text: ""};
                if (hops === MAX_REDIRECTS) return {ok: false, status: "too many redirects", text: ""};
                url = new URL(hop.location, url);
            }
        } catch (error) {
            const err = error as Error;
            if (err instanceof Refused) return {ok: false, status: `not fetched: ${err.message}`, text: ""};
            const timedOut = err.name === "TimeoutError" || (err.name === "AbortError" && signal.aborted);
            return {ok: false, status: timedOut ? "timeout" : err.message, text: ""};
        }
    };
}

export const fetchText = makeFetchText();

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
