import {createServer, type Server, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {gzipSync} from "node:zlib";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {
    MAX_PAGE_BYTES,
    headlineOnPage,
    isPublicAddress,
    makeFetchText,
    matchQuote,
    normalize,
    quoteFragments,
    type Page,
} from "../../../src/lib/quote-check.js";

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

describe("fetchText", () => {
    const BIG = "a".repeat(MAX_PAGE_BYTES + 100);
    const NAMES: Record<string, {address: string; family: number}[]> = {
        "site.test": [{address: "127.0.0.2", family: 4}],
        "private.test": [{address: "10.0.0.5", family: 4}],
        "mixed.test": [
            {address: "93.184.216.34", family: 4},
            {address: "192.168.1.1", family: 4},
        ],
        "metadata.test": [{address: "::ffff:169.254.169.254", family: 6}],
    };
    const lookup = ((hostname: string, _: unknown, callback: (e: Error | null, a: unknown) => void) =>
        NAMES[hostname]
            ? callback(null, NAMES[hostname])
            : callback(
                  Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {code: "ENOTFOUND"}),
                  []
              )) as never;
    const fetchPage = makeFetchText({lookup, isPublic: (a) => a === "127.0.0.2" || isPublicAddress(a)});
    let server: Server;
    let base: string;
    let hits: string[];

    beforeAll(async () => {
        const routes: Record<string, (res: ServerResponse) => void> = {
            "/page": (res) => res.end("<p>hello</p>"),
            "/relative": (res) => res.writeHead(302, {location: "/page"}).end(),
            "/by-name": (res) => res.writeHead(301, {location: `http://site.test:${port()}/page`}).end(),
            "/to-loopback": (res) => res.writeHead(302, {location: `http://127.0.0.1:${port()}/page`}).end(),
            "/to-metadata": (res) => res.writeHead(307, {location: "http://169.254.169.254/latest/meta-data/"}).end(),
            "/to-private-name": (res) => res.writeHead(302, {location: `http://private.test:${port()}/page`}).end(),
            "/to-file": (res) => res.writeHead(302, {location: "file:///etc/passwd"}).end(),
            "/loop": (res) => res.writeHead(302, {location: "/loop"}).end(),
            "/missing": (res) => res.writeHead(404).end("no"),
            "/big": (res) => res.writeHead(200, {"content-length": BIG.length}).end(BIG),
            "/big-chunked": (res) => {
                for (let i = 0; i < BIG.length; i += 65_536) res.write(BIG.slice(i, i + 65_536));
                res.end();
            },
            "/big-gzip": (res) => res.writeHead(200, {"content-encoding": "gzip"}).end(gzipSync(BIG)),
            "/exact": (res) => res.end("b".repeat(MAX_PAGE_BYTES)),
        };
        server = createServer((req, res) => {
            hits.push(req.url ?? "");
            (routes[req.url ?? ""] ?? routes["/missing"])(res);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.2", resolve));
        base = `http://127.0.0.2:${port()}`;
    });

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    beforeEach(() => {
        hits = [];
    });

    function port() {
        return (server.address() as AddressInfo).port;
    }

    it("reads a page on a public host, on any port", async () => {
        expect(await fetchPage(`${base}/page`)).toEqual({ok: true, status: 200, text: "<p>hello</p>"});
    });

    it("reports a page that does not load", async () => {
        expect(await fetchPage(`${base}/missing`)).toEqual({ok: false, status: 404, text: ""});
    });

    it("follows a relative redirect and one to a host by name", async () => {
        expect((await fetchPage(`${base}/relative`)).text).toBe("<p>hello</p>");
        expect((await fetchPage(`${base}/by-name`)).text).toBe("<p>hello</p>");
    });

    it("gives up after too many redirects", async () => {
        expect(await fetchPage(`${base}/loop`)).toEqual({ok: false, status: "too many redirects", text: ""});
        expect(hits).toHaveLength(6);
    });

    it.each(["ftp://one.example/a", "file:///etc/passwd", "data:text/html,<p>x</p>", "javascript:alert(1)"])(
        "refuses a scheme other than http and https, %s",
        async (url) => {
            const page = await fetchPage(url);
            expect(page.ok).toBe(false);
            expect(page.status).toMatch(/^not fetched: \w+: is not http or https$/);
        }
    );

    it.each([
        "http://127.0.0.1/",
        "http://127.255.0.1/",
        "http://10.1.2.3/",
        "http://172.16.0.1/",
        "http://172.31.255.255/",
        "http://192.168.0.1/",
        "http://100.64.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0/",
        "http://0x7f.1/",
        "http://2130706433/",
        "http://[::1]/",
        "http://[::]/",
        "http://[fe80::1]/",
        "http://[fc00::1]/",
        "http://[fd12:3456::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:a9fe:a9fe]/",
        "https://127.0.0.1:8443/",
    ])("refuses a literal non-public host, %s", async (url) => {
        const page = await fetchPage(url);
        expect(page.ok).toBe(false);
        expect(page.status).toMatch(/^not fetched: .+ is not a public address$/);
    });

    it.each(["private.test", "mixed.test", "metadata.test"])(
        "refuses a host that resolves to a non-public address, %s",
        async (host) => {
            const page = await fetchPage(`http://${host}:${port()}/page`);
            expect(page.ok).toBe(false);
            expect(page.status).toMatch(new RegExp(`^not fetched: ${host} resolves to .+, not a public address$`));
        }
    );

    it.each(["/to-loopback", "/to-metadata", "/to-private-name", "/to-file"])(
        "refuses a redirect to a non-public address, %s",
        async (path) => {
            const page = await fetchPage(`${base}${path}`);
            expect(page.ok).toBe(false);
            expect(page.status).toMatch(/^not fetched: /);
            expect(hits).toEqual([path]);
        }
    );

    it.each(["/big", "/big-chunked", "/big-gzip"])("stops reading at the cap, %s", async (path) => {
        const page = await fetchPage(`${base}${path}`);
        expect(page.ok).toBe(true);
        expect(page.text).toHaveLength(MAX_PAGE_BYTES);
    });

    it("keeps a body exactly at the cap", async () => {
        expect((await fetchPage(`${base}/exact`)).text).toBe("b".repeat(MAX_PAGE_BYTES));
    });
});

describe("isPublicAddress", () => {
    it.each([
        ["8.8.8.8", true],
        ["93.184.216.34", true],
        ["172.32.0.1", true],
        ["100.128.0.1", true],
        ["2606:4700::1111", true],
        ["127.0.0.1", false],
        ["10.0.0.1", false],
        ["172.16.5.4", false],
        ["192.168.1.1", false],
        ["100.64.0.1", false],
        ["169.254.169.254", false],
        ["0.0.0.0", false],
        ["::", false],
        ["::1", false],
        ["fe80::1", false],
        ["fc00::1", false],
        ["::ffff:10.0.0.1", false],
        ["not an address", false],
    ])("%s is public: %s", (address, expected) => {
        expect(isPublicAddress(address)).toBe(expected);
    });
});
