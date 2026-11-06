import {describe, expect, it} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {BASE_URL, get} from "./helpers.js";

describe("robots, sitemap and noindex", () => {
    it("serves robots.txt naming the sitemap", async () => {
        const res = await get("/robots.txt");

        expect(res.status).toBe(200);
        expect(res.html).toContain("Disallow: /admin\nDisallow: /api/\n");
        expect(res.html).toContain(`Sitemap: ${BASE_URL}/sitemap.xml`);
        expect(res.headers.get("x-robots-tag")).toBeNull();
    });

    it("lists the public pages and every match in the sitemap, and nothing private", async () => {
        const res = await get("/sitemap.xml");
        const locs = [...res.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        const seed = await readSeed();

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
        for (const path of ["/", "/results", "/race", "/honours", "/rules", "/club/altman", "/25-26/club/altman"]) {
            expect(locs).toContain(`${BASE_URL}${path}`);
        }
        expect(locs.filter((loc) => loc.includes("/match/"))).toHaveLength(seed.length);
        expect(locs.some((loc) => /\/(admin|api|s)\//.test(loc))).toBe(false);
    });

    it("lists only pages that render", async () => {
        const res = await get("/sitemap.xml");
        const paths = [...res.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].slice(BASE_URL.length));

        const statuses = await Promise.all(paths.map(async (path) => [path, (await get(path)).status]));

        expect(statuses.filter(([, status]) => status !== 200)).toEqual([]);
    });

    it.each(["/admin/login", "/admin/", "/api/nothing"])("marks %s noindex, nofollow", async (path) => {
        expect((await get(path)).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    });

    it("keeps share pages and error pages out of the index", async () => {
        const [first] = await readSeed();

        const share = await get(`/s/${first.id}`);
        const missing = await get("/nope");

        expect(share.html).toContain(`<meta name="robots" content="noindex">`);
        expect(share.html).toContain(`<link rel="canonical" href="${BASE_URL}/match/${first.id}">`);
        expect(missing.html).toContain(`<meta name="robots" content="noindex">`);
        expect((await get("/")).html).not.toContain(`name="robots"`);
    });
});
