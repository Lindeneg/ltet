import {describe, expect, it} from "vitest";
import {readSeed} from "../../src/lib/content.js";
import {BASE_URL, get} from "./helpers.js";

function pngSize(png: Buffer) {
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

async function image(path: string) {
    const res = await fetch(BASE_URL + path);
    return {res, png: Buffer.from(await res.arrayBuffer())};
}

describe("previews and share pages", () => {
    it("draws the site's card", async () => {
        const {res, png} = await image("/og.png");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
        expect(pngSize(png)).toEqual({width: 1200, height: 630});
    });

    it("draws a statement's card", async () => {
        const [first] = await readSeed();

        const {res, png} = await image(`/og/${first.id}.png`);

        expect(res.status).toBe(200);
        expect(pngSize(png)).toEqual({width: 1200, height: 630});
    });

    it("has no card for an unknown statement", async () => {
        expect((await get("/og/nobody.png")).status).toBe(404);
    });

    it("gives a share page the statement's preview and forwards to its match report", async () => {
        const [first] = await readSeed();

        const res = await get(`/s/${first.id}`);

        expect(res.status).toBe(200);
        expect(res.html).toContain(`<meta property="og:image" content="${BASE_URL}/og/${first.id}.png">`);
        expect(res.html).toContain(`<link rel="canonical" href="${BASE_URL}/match/${first.id}">`);
        expect(res.html).toContain(`<meta http-equiv="refresh" content="0; url=/match/${first.id}">`);
    });

    it("sends a share page for an unknown statement to the front page", async () => {
        const res = await get("/s/nobody");

        expect(res.status).toBe(302);
        expect(res.location).toBe("/");
    });
});
