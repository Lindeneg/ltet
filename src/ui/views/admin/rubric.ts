import {LEVELS, type Level, type Rubric} from "../../../lib/content.js";
import {AdminLayout} from "../../components/admin-layout.js";
import {ErrorBox} from "../../components/admin-parts.js";
import {attrs, esc} from "../../lib.js";
import type {AdminPage} from "./page.js";

export const CATEGORY_FIELDS = [
    "name",
    "question",
    "level0",
    "level1",
    "level3",
    "level5",
    "weight",
    "awardName",
    "awardFor",
] as const;

export const levelField = (level: Level) => `level${level}` as const;

const levelLabel = (level: Level) => `Scores ${level}`;

export type RubricValues = Record<string, string>;

export type RubricViewProps = {
    page: AdminPage;
    rubric: Rubric;
    values?: RubricValues;
    errors?: Record<string, string>;
    topError?: string;
};

export const categoryField = (id: string, name: (typeof CATEGORY_FIELDS)[number]) => `${name}_${id}`;

export function rubricValues(rubric: Rubric): RubricValues {
    const values: RubricValues = {unitOne: rubric.unit.one, unitMany: rubric.unit.many};
    for (const c of rubric.categories) {
        values[categoryField(c.id, "name")] = c.name;
        values[categoryField(c.id, "question")] = c.question;
        for (const level of LEVELS) values[categoryField(c.id, levelField(level))] = c.levels[level];
        values[categoryField(c.id, "weight")] = String(c.weight);
        values[categoryField(c.id, "awardName")] = c.award.name;
        values[categoryField(c.id, "awardFor")] = c.award.for;
    }
    return values;
}

function field(name: string, label: string, values: RubricValues, errors: Record<string, string>, type = "text") {
    const error = errors[name] ? `<span class="error">${esc(errors[name])}</span>` : "";
    const extra = type === "number" ? {min: "1", max: "10", step: "1"} : {};
    return `<label>${esc(label)} <input${attrs({name, type, value: values[name] ?? "", ...extra})} />${error}</label>`;
}

export function RubricView({
    page,
    rubric,
    values = rubricValues(rubric),
    errors = {},
    topError,
}: RubricViewProps): string {
    const categories = rubric.categories
        .map(
            (c) => `
                <fieldset class="card stack">
                    <legend>${esc(c.id)}</legend>
                    ${field(categoryField(c.id, "name"), "Name", values, errors)}
                    ${field(categoryField(c.id, "question"), "Question", values, errors)}
                    ${LEVELS.map((level) => field(categoryField(c.id, levelField(level)), levelLabel(level), values, errors)).join("")}
                    ${field(categoryField(c.id, "weight"), "Weight", values, errors, "number")}
                    ${field(categoryField(c.id, "awardName"), "Award name", values, errors)}
                    ${field(categoryField(c.id, "awardFor"), "Award text", values, errors)}
                </fieldset>`
        )
        .join("");
    return AdminLayout({
        ...page,
        children: `
            <div class="toolbar"><h1>Rubric</h1></div>
            <form method="post" action="/admin/rubric">
                ${ErrorBox(topError)}
                <section class="card stack">
                    ${field("unitOne", "Unit (one)", values, errors)}
                    ${field("unitMany", "Unit (many)", values, errors)}
                </section>
                <p class="note">A weight change rescores every statement at once.</p>
                ${categories}
                <div class="actions"><button type="submit">Save the rubric</button></div>
            </form>`,
    });
}
