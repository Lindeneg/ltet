import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import LeagueService, {ALL_TIME_KEY} from "../../../src/services/league-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {fake, makeCeo, makeContent, makeStatement, makeContentService} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 15, 12);

function setup(statements: RawStatement[], clock = () => NOW) {
    const listPublished = vi.fn().mockResolvedValue(success(statements));
    const repo = fake<StatementRepository>({listPublished});
    const content = makeContent({
        ceos: [makeCeo(), makeCeo({id: "musk", name: "Elon Musk"}), makeCeo({id: "huang", name: "Jensen Huang"})],
    });
    return {listPublished, league: new LeagueService(repo, makeContentService(content), clock)};
}

async function load(league: LeagueService) {
    const result = await league.get();
    if (!result.ok) throw new Error(result.ctx);
    return result.data;
}

describe("LeagueService", () => {
    it("loads the statements once and again after a change", async () => {
        const {league, listPublished} = setup([makeStatement()]);

        const first = await load(league);
        await load(league);
        league.invalidate();
        const second = await load(league);

        expect(listPublished).toHaveBeenCalledTimes(2);
        expect(second.stamp).not.toBe(first.stamp);
    });

    it("rebuilds when the day turns", async () => {
        let now = NOW;
        const {league, listPublished} = setup([makeStatement()], () => now);

        const first = await load(league);
        now += 24 * 60 * 60 * 1000;
        const second = await load(league);

        expect(listPublished).toHaveBeenCalledTimes(2);
        expect(second.stamp).not.toBe(first.stamp);
    });

    it("does not keep a failed load", async () => {
        const {league, listPublished} = setup([]);
        listPublished.mockResolvedValueOnce(failure(AppError.DB_ERROR));

        expect(await league.get()).toEqual(failure(AppError.DB_ERROR));
        expect((await league.get()).ok).toBe(true);
    });

    it("lists the seasons with all time as the default", async () => {
        const league = await load(setup([]).league);

        expect(league.defaultKey).toBe(ALL_TIME_KEY);
        expect(league.seasons.map((s) => s.key)).toEqual(["26-27", "25-26", "24-25", "23-24", "22-23"]);
        expect(league.seasonByKey.get(ALL_TIME_KEY)).toBe(league.allTime);
    });

    it("builds a season from its own statements and all time from every one", async () => {
        const league = await load(
            setup([
                makeStatement({id: "old", date: "2025-09-01"}, {loss: 5, doom: 5}),
                makeStatement({id: "new", ceo: "musk", date: "2026-09-01"}, {loss: 1, doom: 0}),
            ]).league
        );

        expect(league.context("26-27").statements.map((s) => s.id)).toEqual(["new"]);
        expect(league.context(ALL_TIME_KEY).statements.map((s) => s.id)).toEqual(["old", "new"]);
        expect(league.context("26-27")).toBe(league.context("26-27"));
    });

    it("finds the champions, the foot, shared places and the lead", async () => {
        const ctx = (
            await load(
                setup([
                    makeStatement({id: "a", date: "2026-09-01"}, {loss: 4, doom: 0}),
                    makeStatement({id: "b", ceo: "musk", date: "2026-09-02"}, {loss: 1, doom: 0}),
                    makeStatement({id: "c", ceo: "huang", date: "2026-09-03"}, {loss: 1, doom: 0}),
                ]).league
            )
        ).context("26-27");

        expect(ctx.champions.map((row) => row.ceo.id)).toEqual(["altman"]);
        expect(ctx.foot.map((row) => row.ceo.id).sort()).toEqual(["huang", "musk"]);
        expect(ctx.place.get("musk")).toEqual({pos: 2, tied: true});
        expect(ctx.lead).toBe(3);
        expect(ctx.inProgress).toBe(true);
        expect(ctx.totalForks).toBe(6);
    });

    it("counts places moved with the latest result day, taking its statements together", async () => {
        const ctx = (
            await load(
                setup([
                    makeStatement({id: "early", ceo: "musk", date: "2026-10-01"}, {loss: 2, doom: 0}),
                    makeStatement({id: "late", date: "2026-11-02"}, {loss: 5, doom: 0}),
                    makeStatement({id: "same-day", ceo: "huang", date: "2026-11-02"}, {loss: 1, doom: 0}),
                ]).league
            )
        ).context("26-27");

        expect(ctx.showMovement).toBe(true);
        expect(ctx.latestDay).toBe(Date.UTC(2026, 10, 2));
        expect(ctx.movement.get("altman")).toBe(1);
        expect(ctx.movement.get("musk")).toBe(-1);
        expect(ctx.movement.get("huang")).toBe(-1);
    });

    it("hides movement when the window has only one result day", async () => {
        const league = await load(
            setup([
                makeStatement({id: "one", date: "2026-11-02"}, {loss: 5, doom: 0}),
                makeStatement({id: "two", ceo: "musk", date: "2026-11-02"}, {loss: 2, doom: 0}),
            ]).league
        );

        expect(league.context("26-27").showMovement).toBe(false);
        expect(league.context(ALL_TIME_KEY).showMovement).toBe(false);
    });

    it("hides movement in a finished season", async () => {
        const ctx = (
            await load(
                setup([
                    makeStatement({id: "early", date: "2025-09-01"}),
                    makeStatement({id: "late", ceo: "musk", date: "2025-10-01"}),
                ]).league
            )
        ).context("25-26");

        expect(ctx.showMovement).toBe(false);
    });

    it("gives each count's award and the cake", async () => {
        const ctx = (
            await load(
                setup([
                    makeStatement({id: "a", date: "2026-09-01"}, {loss: 4, doom: 0}),
                    makeStatement({id: "b", ceo: "musk", date: "2026-09-02"}, {loss: 1, doom: 3}),
                ]).league
            )
        ).context("26-27");

        expect(ctx.awards.map((a) => [a.category.id, a.winners.map((w) => w.ceo.id), a.margin])).toEqual([
            ["loss", ["altman"], 3],
            ["doom", ["musk"], 6],
        ]);
        expect(ctx.cakes.map((s) => s.id)).toEqual(["b"]);
    });

    it("draws a snapshot per month up to today", async () => {
        const ctx = (await load(setup([makeStatement({date: "2026-09-10"})]).league)).context("26-27");

        expect(ctx.snapshots.map((s) => [s.month, s.inPlay])).toEqual([
            [7, false],
            [8, false],
            [9, false],
            [10, true],
        ]);
        expect(ctx.snapshots.at(-1)!.time).toBe(NOW);
    });
});
