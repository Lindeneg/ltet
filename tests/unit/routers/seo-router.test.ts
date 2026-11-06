import {afterEach, describe, expect, it, vi} from "vitest";
import express from "express";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type SitemapService from "../../../src/services/sitemap-service.js";
import type {SitemapEntry} from "../../../src/services/sitemap-service.js";
import {makeSeoRouter} from "../../../src/routers/seo-router.js";
import {fake} from "../helpers.js";
import {serve, type Served} from "../serve.js";

const ENTRIES: SitemapEntry[] = [
    {path: "/", lastmod: Date.UTC(2026, 0, 2, 3, 4, 5, 678)},
    {path: "/rules", lastmod: null},
    {path: "/match/a&b'<c>\"", lastmod: Date.UTC(2025, 5, 6)},
];

describe("seo router", () => {
    let server: Served;

    async function start(opts: {publicUrl?: string; trustProxy?: boolean; get?: SitemapService["get"]} = {}) {
        const get = opts.get ?? vi.fn().mockResolvedValue(success(ENTRIES));
        const app = express();
        if (opts.trustProxy) app.set("trust proxy", true);
        app.use(makeSeoRouter({sitemapService: fake<SitemapService>({get}), publicUrl: opts.publicUrl}));
        app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(500).send("error");
        });
        server = await serve(app);
    }

    afterEach(() => server.close());

    it("lets crawlers in everywhere but the CMS and the API, and names the sitemap", async () => {
        await start();

        const res = await fetch(`${server.url}/robots.txt`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await res.text()).toBe(
            `User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${server.url}/sitemap.xml\n`
        );
    });

    it("names the sitemap under PUBLIC_URL when set", async () => {
        await start({publicUrl: "https://ltet.example"});

        expect(await (await fetch(`${server.url}/robots.txt`)).text()).toContain(
            "Sitemap: https://ltet.example/sitemap.xml"
        );
    });

    it("takes the protocol the proxy forwards", async () => {
        await start({trustProxy: true});

        const res = await fetch(`${server.url}/robots.txt`, {headers: {"x-forwarded-proto": "https"}});

        expect(await res.text()).toContain(`Sitemap: https://${new URL(server.url).host}/sitemap.xml`);
    });

    it("serves the sitemap as escaped absolute urls with W3C dates", async () => {
        await start({publicUrl: "https://ltet.example"});

        const res = await fetch(`${server.url}/sitemap.xml`);
        const xml = await res.text();

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
        expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n`)).toBe(true);
        expect(xml).toContain(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`);
        expect(xml).toContain(
            "<url><loc>https://ltet.example/</loc><lastmod>2026-01-02T03:04:05+00:00</lastmod></url>"
        );
        expect(xml).toContain("<url><loc>https://ltet.example/rules</loc></url>");
        expect(xml).toContain(
            "<loc>https://ltet.example/match/a&amp;b&#39;&lt;c&gt;&quot;</loc><lastmod>2025-06-06T00:00:00+00:00</lastmod>"
        );
    });

    it("answers HEAD on both paths", async () => {
        await start();

        for (const path of ["/robots.txt", "/sitemap.xml"]) {
            const res = await fetch(`${server.url}${path}`, {method: "HEAD"});
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("");
        }
    });

    it("passes a failed sitemap on as an error", async () => {
        await start({get: vi.fn().mockResolvedValue(failure(AppError.DB_ERROR))});

        expect((await fetch(`${server.url}/sitemap.xml`)).status).toBe(500);
    });
});
