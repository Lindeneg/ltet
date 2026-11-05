import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {tally} from "../../../src/lib/score.js";
import {SEED_PHOTOS_DIR} from "../../../src/lib/paths.js";
import PreviewService, {OG_HEIGHT, OG_WIDTH} from "../../../src/services/preview-service.js";
import {fakeLog, makeCeo, makeContent, makeStatement, makeContentService} from "../helpers.js";

const content = makeContent({ceos: [makeCeo(), makeCeo({id: "nobody", name: "No Photo", company: "None"})]});

function scored() {
    return tally(content.ceos, content.rubric, [
        makeStatement(),
        makeStatement({id: "nobody-statement", ceo: "nobody", leaked: true}),
    ]);
}

function pngSize(png: Buffer) {
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

describe("PreviewService", () => {
    it("draws a statement's card as a 1200 by 630 png, with a photo or with initials", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());
        const {statements} = scored();

        for (const statement of statements) {
            expect(pngSize(await previews.statementCard(statement))).toEqual({width: OG_WIDTH, height: OG_HEIGHT});
        }
    });

    it("draws the site's card as a 1200 by 630 png", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());
        const {statements, standings} = scored();

        const png = await previews.siteCard("25-26", () => ({standings, statements}));

        expect(pngSize(png)).toEqual({width: OG_WIDTH, height: OG_HEIGHT});
    });

    it("draws once for simultaneous requests and again after clear", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());
        const {statements, standings} = scored();
        const card = vi.fn(() => ({standings, statements}));

        const [a, b] = await Promise.all([previews.siteCard("25-26", card), previews.siteCard("25-26", card)]);
        expect(a).toBe(b);
        expect(card).toHaveBeenCalledTimes(1);

        previews.clear();
        await previews.siteCard("25-26", card);
        expect(card).toHaveBeenCalledTimes(2);
    });

    it("draws a new season's card under its own key", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());
        const {statements, standings} = scored();
        const card = vi.fn(() => ({standings, statements}));

        await previews.siteCard("25-26", card);
        await previews.siteCard("26-27", card);

        expect(card).toHaveBeenCalledTimes(2);
    });

    it("forgets a failed draw so the next request tries again", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());
        const {statements, standings} = scored();
        const card = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error("boom");
            })
            .mockReturnValue({standings, statements});

        await expect(previews.siteCard("25-26", card)).rejects.toThrow("boom");
        expect(pngSize(await previews.siteCard("25-26", card)).width).toBe(OG_WIDTH);
    });

    it("draws a real jpeg and refuses one that only starts like one", async () => {
        const previews = new PreviewService(makeContentService(content), SEED_PHOTOS_DIR, fakeLog());

        expect(await previews.canDraw(await readFile(join(SEED_PHOTOS_DIR, "altman.jpg")))).toBe(true);
        expect(await previews.canDraw(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("junk")]))).toBe(
            false
        );
    });

    it("draws the crest and logs when a stored photo can't be drawn", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ltet-previews-"));
        try {
            await writeFile(
                join(dir, "altman.jpg"),
                Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("junk")])
            );
            const log = fakeLog();
            const previews = new PreviewService(makeContentService(content), dir, log);
            const {statements} = scored();

            expect(pngSize(await previews.statementCard(statements.find((s) => s.who.id === "altman")!))).toEqual({
                width: OG_WIDTH,
                height: OG_HEIGHT,
            });
            expect(log.error).toHaveBeenCalledWith({contender: "altman"}, expect.any(String));
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
