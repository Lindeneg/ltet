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
                score_doom: "",
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
                    scores: {loss: {score: "4", reason: " Why. "}, doom: {score: "", reason: ""}},
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
});
