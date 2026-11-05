import type {Rubric} from "../../lib/content.js";
import {failure, success, type Result} from "../../lib/result.js";
import type {EditorValues} from "../../ui/components/admin-parts.js";

export type EditorForm = {statement: unknown; values: EditorValues};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function readEditor(
    body: Record<string, unknown>,
    rubric: Rubric
): Result<EditorForm, {message: string; values: EditorValues}> {
    const values: EditorValues = {
        json: text(body.json),
        scores: Object.fromEntries(
            rubric.categories.map((c) => [
                c.id,
                {score: text(body[`score_${c.id}`]), reason: text(body[`reason_${c.id}`])},
            ])
        ),
    };
    let parsed: unknown;
    try {
        parsed = JSON.parse(values.json);
    } catch (err) {
        return failure({message: `The JSON does not parse: ${(err as Error).message}`, values});
    }
    const scores = Object.fromEntries(
        rubric.categories.map((c) => [
            c.id,
            {score: Number(values.scores[c.id].score), reason: values.scores[c.id].reason.trim()},
        ])
    );
    return success({statement: {...(parsed as object), scores}, values});
}
