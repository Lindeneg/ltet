import {describe, expect, it} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {db, get} from "./helpers.js";

describe("the server, once started", () => {
    it("answers its health check", async () => {
        const res = await get("/healthz");

        expect(res.status).toBe(200);
        expect(JSON.parse(res.html)).toEqual({status: "ok"});
    });

    it("has seeded the store from the seed file", async () => {
        const seed = await readSeed();

        expect(await db.p.statement.count({where: {origin: "seed"}})).toBe(seed.length);
        expect(await db.p.statement.count({where: {origin: "seed", published: true}})).toBe(seed.length);
    });

    it("serves the files in public", async () => {
        const res = await get("/styles.css");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/css");
    });

    it("sets the security headers", async () => {
        const res = await get("/healthz");
        const csp = res.headers.get("content-security-policy") ?? "";

        expect(res.headers.get("x-powered-by")).toBeNull();
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("style-src 'self';");
        expect(csp).toContain("font-src 'self';");
        expect(csp).not.toMatch(/googleapis|gstatic/);
    });

    it("serves every font the stylesheet and the head name", async () => {
        const css = (await get("/styles.css")).html;
        const page = (await get("/")).html;
        const urls = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1]);
        const preloads = [...page.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]);

        expect(urls).toHaveLength(18);
        expect(preloads).toHaveLength(2);
        expect(urls).toEqual(expect.arrayContaining(preloads));
        expect(page).not.toMatch(/googleapis|gstatic/);
        for (const url of urls) {
            const res = await get(url);
            expect(res.status, url).toBe(200);
            expect(res.headers.get("content-type")).toBe("font/woff2");
            expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
        }
    });

    it("keeps each font's licence beside it", async () => {
        for (const family of ["barlow-condensed", "inter"]) {
            const res = await get(`/fonts/${family}/OFL.txt`);
            expect(res.status).toBe(200);
            expect(res.html).toContain("SIL Open Font License, Version 1.1");
        }
    });
});
