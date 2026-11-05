import {describe, expect, it} from "vitest";
import {maxPitchforks, points, tally} from "../../../src/lib/score.js";
import {makeCeo, makeContent, makeRubric, makeStatement} from "../helpers.js";

describe("score", () => {
    it("weighs each count", () => {
        const rubric = makeRubric();
        const statement = makeStatement({}, {loss: 3, doom: 2});

        expect(points(statement, rubric.categories[0])).toBe(3);
        expect(points(statement, rubric.categories[1])).toBe(4);
    });

    it("knows the most a statement can raise", () => {
        expect(maxPitchforks(makeRubric())).toBe(15);
    });

    it("tallies statements oldest first with their pitchforks and contender", () => {
        const {ceos, rubric} = makeContent();
        const late = makeStatement({id: "late", date: "2025-10-01"}, {loss: 1, doom: 0});
        const early = makeStatement({id: "early", date: "2025-09-01"}, {loss: 2, doom: 1});

        const {statements} = tally(ceos, rubric, [late, early]);

        expect(statements.map((s) => [s.id, s.forks])).toEqual([
            ["early", 4],
            ["late", 1],
        ]);
        expect(statements[0].who).toMatchObject({id: "altman", shortName: "Altman"});
        expect(statements[0].time).toBe(Date.UTC(2025, 8, 1));
    });

    it("orders the standings by total, then by name", () => {
        const ceos = [
            makeCeo({id: "b", name: "Bea Zed"}),
            makeCeo({id: "a", name: "Ann Zed"}),
            makeCeo({id: "c", name: "Cy"}),
        ];
        const statements = [
            makeStatement({id: "one", ceo: "b"}, {loss: 2, doom: 0}),
            makeStatement({id: "two", ceo: "a"}, {loss: 2, doom: 0}),
            makeStatement({id: "three", ceo: "c"}, {loss: 5, doom: 0}),
        ];

        const {standings} = tally(ceos, makeRubric(), statements);

        expect(standings.map((row) => [row.ceo.id, row.total])).toEqual([
            ["c", 5],
            ["a", 2],
            ["b", 2],
        ]);
    });

    it("keeps each contender's points per count", () => {
        const {ceos, rubric} = makeContent();
        const statements = [
            makeStatement({id: "small"}, {loss: 1, doom: 1}),
            makeStatement({id: "big", date: "2025-09-02"}, {loss: 4, doom: 2}),
        ];

        const altman = tally(ceos, rubric, statements).standings.find((row) => row.ceo.id === "altman")!;

        expect(altman.byCategory).toEqual({loss: 5, doom: 6});
    });

    it("gives a contender without statements nothing", () => {
        const {ceos, rubric} = makeContent();

        const musk = tally(ceos, rubric, [makeStatement()]).standings.find((row) => row.ceo.id === "musk")!;

        expect(musk).toMatchObject({total: 0, own: [], byCategory: {loss: 0, doom: 0}});
    });
});
