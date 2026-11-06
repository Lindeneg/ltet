import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import LeagueService from "../../../src/services/league-service.js";
import SitemapService from "../../../src/services/sitemap-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {fake, makeContent, makeStatement, makeContentService} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 15, 12);
const ALTMAN = makeStatement();
const MUSK = makeStatement({id: "musk-2023-03-10-x", ceo: "musk", date: "2023-03-10"});
const ALTMAN_CHANGED = Date.UTC(2026, 0, 2, 3, 4, 5);
const MUSK_CHANGED = Date.UTC(2025, 5, 6);

function makeSitemap(statements: RawStatement[] = [ALTMAN, MUSK]) {
    const listPublished = vi.fn().mockResolvedValue(success(statements));
    const listChanges = vi.fn().mockResolvedValue(
        success(
            new Map([
                [ALTMAN.id, new Date(ALTMAN_CHANGED)],
                [MUSK.id, new Date(MUSK_CHANGED)],
                ["hidden-one", new Date(NOW)],
            ])
        )
    );
    const repo = fake<StatementRepository>({listPublished, listChanges});
    const league = new LeagueService(repo, makeContentService(makeContent()), () => NOW);
    return {listPublished, listChanges, league, sitemap: new SitemapService(league, repo)};
}

async function entries(sitemap: SitemapService) {
    const result = await sitemap.get();
    if (!result.ok) throw new Error(String(result.ctx));
    return new Map(result.data.map((e) => [e.path, e.lastmod]));
}

describe("SitemapService", () => {
    it("lists every public page of all time, each season, the rules and every match", async () => {
        const paths = [...(await entries(makeSitemap().sitemap)).keys()];

        expect(paths.slice(0, 4)).toEqual(["/", "/results", "/race", "/honours"]);
        expect(paths.slice(4, 6).sort()).toEqual(["/club/altman", "/club/musk"]);
        expect(paths[6]).toBe("/rules");
        for (const season of ["22-23", "23-24", "24-25", "25-26", "26-27"]) {
            for (const tail of ["", "/results", "/race", "/honours", "/club/altman", "/club/musk"]) {
                expect(paths).toContain(`/${season}${tail}`);
            }
        }
        expect(paths.slice(-2)).toEqual([`/match/${ALTMAN.id}`, `/match/${MUSK.id}`]);
        expect(paths).toHaveLength(7 + 5 * 6 + 2);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it("dates a match by its own change and a list by its newest statement's change", async () => {
        const map = await entries(makeSitemap().sitemap);

        expect(map.get(`/match/${MUSK.id}`)).toBe(MUSK_CHANGED);
        expect(map.get("/")).toBe(ALTMAN_CHANGED);
        expect(map.get("/club/musk")).toBe(MUSK_CHANGED);
        expect(map.get("/22-23/race")).toBe(MUSK_CHANGED);
        expect(map.get("/25-26/club/musk")).toBeNull();
        expect(map.get("/rules")).toBeNull();
    });

    it("leaves out hidden statements", async () => {
        const paths = [...(await entries(makeSitemap().sitemap)).keys()];

        expect(paths.some((p) => p.includes("hidden-one"))).toBe(false);
    });

    it("lists the pages without dates for an empty league and a season without statements", async () => {
        const map = await entries(makeSitemap([]).sitemap);

        expect(map.get("/")).toBeNull();
        expect(map.get("/26-27/club/altman")).toBeNull();
        expect([...map.keys()].some((p) => p.startsWith("/match/"))).toBe(false);
    });

    it("encodes ids in paths", async () => {
        const odd = makeStatement({id: "altman a&b"});

        const map = await entries(makeSitemap([odd]).sitemap);

        expect(map.has("/match/altman%20a%26b")).toBe(true);
    });

    it("reuses its list until the league changes", async () => {
        const {sitemap, league, listChanges} = makeSitemap();

        const first = await sitemap.get();
        await sitemap.get();
        expect(listChanges).toHaveBeenCalledTimes(1);

        league.invalidate();
        const second = await sitemap.get();

        expect(listChanges).toHaveBeenCalledTimes(2);
        expect(second).not.toBe(first);
    });

    it("fails when the changes can't be read", async () => {
        const {sitemap, listChanges} = makeSitemap();
        listChanges.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await sitemap.get()).ok).toBe(false);
    });
});
