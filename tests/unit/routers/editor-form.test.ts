import {describe, expect, it} from "vitest";
import {readEditor} from "../../../src/routers/admin/editor-form.js";
import {makeRubric} from "../helpers.js";

describe("readEditor", () => {
    it("puts the scores from their fields into the statement from the json", () => {
        const result = readEditor(
            {
                json: `{"id": "x", "scores": {"old": 1}}`,
                score_loss: "4",
                reason_loss: " Why. ",
                score_doom: "0",
                reason_doom: "",
            },
            makeRubric()
        );

        expect(result).toEqual({
            ok: true,
            data: {
                statement: {id: "x", scores: {loss: {score: 4, reason: "Why."}, doom: {score: 0, reason: ""}}},
                values: {
                    json: `{"id": "x", "scores": {"old": 1}}`,
                    scores: {loss: {score: "4", reason: " Why. "}, doom: {score: "0", reason: ""}},
                },
            },
        });
    });

    it("says why the json does not parse and keeps what was typed", () => {
        const result = readEditor({json: "{", score_loss: "2"}, makeRubric());

        if (result.ok) throw new Error("expected failure");
        expect(result.ctx.message).toMatch(/^The JSON does not parse: /);
        expect(result.ctx.values.json).toBe("{");
        expect(result.ctx.values.scores.loss.score).toBe("2");
    });

    it("names every category whose score is blank and keeps what was typed", () => {
        for (const blank of ["", " "]) {
            const result = readEditor(
                {json: `{"id": "x"}`, score_loss: blank, reason_loss: "Why.", score_doom: blank},
                makeRubric()
            );

            if (result.ok) throw new Error("expected failure");
            expect(result.ctx.message).toBe("The score for What you'll lose, Doom is missing.");
            expect(result.ctx.values.scores.loss.reason).toBe("Why.");
        }
    });

    it("leaves a fraction or a negative score to the statement rules", () => {
        for (const [typed, score] of [
            ["3.5", 3.5],
            ["-1", -1],
        ] as const) {
            const result = readEditor({json: `{"id": "x"}`, score_loss: typed, score_doom: "0"}, makeRubric());

            if (!result.ok) throw new Error("expected success");
            expect((result.data.statement as {scores: Record<string, {score: number}>}).scores.loss.score).toBe(score);
        }
    });
});
