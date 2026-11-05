import {readFile, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {loadContent} from "../../src/lib/content.js";
import {photosDir, SEED_PHOTOS_DIR} from "../../src/lib/paths.js";
import {BASE_URL, get} from "./helpers.js";

const store = photosDir(process.env.DATABASE_URL!);
const probe = join(store, "e2e-probe.jpg");

describe("contenders, the rubric and the photo store", () => {
    afterAll(() => rm(probe, {force: true}));

    it("copies the seed photos into the store", async () => {
        const seed = (await readdir(SEED_PHOTOS_DIR)).filter((file) => file.endsWith(".jpg"));

        expect((await readdir(store)).filter((file) => file !== "e2e-probe.jpg").sort()).toEqual(seed.sort());
        expect(await readFile(join(store, "altman.jpg"))).toEqual(await readFile(join(SEED_PHOTOS_DIR, "altman.jpg")));
    });

    it("serves the photos from the store", async () => {
        await writeFile(probe, "only in the store");

        const res = await fetch(`${BASE_URL}/assets/ceos/e2e-probe.jpg`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
        expect(await res.text()).toBe("only in the store");
    });

    it("shows the seeded contenders and their photo credits on the rules page", async () => {
        const {ceos} = await loadContent();

        const res = await get("/rules");

        expect(res.status).toBe(200);
        for (const ceo of ceos) expect(res.html).toContain(`<strong>${ceo.name}</strong>`);
    });
});
