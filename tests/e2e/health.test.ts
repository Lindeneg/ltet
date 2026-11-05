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
    });
});
