import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {isId, isRealDate, isUrl, statementErrors, validate} from "../../../src/lib/statement-rules.js";
import {makeContent, makeStatement} from "../helpers.js";

const rules = makeContent();
const readData = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../../prisma/seed/${name}`, import.meta.url), "utf8"));

describe("statement rules", () => {
    it("checks ids, urls and dates", () => {
        expect(isId("altman-2025")).toBe(true);
        expect(isId("Altman 2025")).toBe(false);
        expect(isUrl("https://example.com/a")).toBe(true);
        expect(isUrl("ftp://example.com")).toBe(false);
        expect(isUrl("not a url")).toBe(false);
        expect(isRealDate("2025-02-28")).toBe(true);
        expect(isRealDate("2025-2-28")).toBe(false);
    });

    it("accepts a valid statement", () => {
        expect(statementErrors(makeStatement(), rules)).toEqual([]);
    });

    it("names each problem in a plain sentence", () => {
        const statement = {
            ...makeStatement({id: "Bad Id", ceo: "nobody", date: "2999-01-01", quote: " "}),
            sources: [{outlet: "Same", title: "One", url: "https://a.example"}],
            scores: {loss: {score: 6, reason: "Too many."}, extra: {score: 1, reason: "Unknown."}},
        };

        expect(statementErrors(statement, rules)).toEqual([
            "id must be kebab-case",
            'unknown ceo "nobody"',
            "date is in the future",
            "quote missing",
            "needs sources from at least two different outlets",
            "score for loss must be an integer from 0 to 5",
            "score for doom must be an integer from 0 to 5",
            "reason for doom missing",
            "score for unknown category extra",
        ]);
    });

    it("starts the record on 2022-11-30", () => {
        expect(statementErrors(makeStatement({date: "2022-11-30"}), rules)).toEqual([]);
        expect(statementErrors(makeStatement({date: "2022-11-29"}), rules)).toEqual([
            "date is before the record starts on 2022-11-30",
        ]);
    });

    it("refuses a fraction or a negative score", () => {
        for (const score of [3.5, -1]) {
            const statement = makeStatement();
            statement.scores.loss = {...statement.scores.loss, score};

            expect(statementErrors(statement, rules)).toEqual(["score for loss must be an integer from 0 to 5"]);
        }
    });

    it("treats a missing statement as one with every field missing", () => {
        expect(statementErrors(undefined, rules)).toContain("venue missing");
    });

    it("requires a manual check to have a date and a note", () => {
        const statement = makeStatement({manualCheck: {date: "2025-01-01", note: ""}});

        expect(statementErrors(statement, rules)).toEqual(["manualCheck needs a date and a note"]);
    });

    it("finds duplicate ids across the record", () => {
        const errors = validate({...rules, statements: [makeStatement(), makeStatement()]});

        expect(errors).toEqual(["statement altman-2025-09-01-statement: duplicate id"]);
    });

    it("requires every count to say what scores 0, 1, 3 and 5", () => {
        const [loss, doom] = rules.rubric.categories;
        const rubric = {...rules.rubric, categories: [{...loss, levels: {...loss.levels, 3: ""}}, doom]};

        expect(validate({...rules, rubric, statements: []})).toEqual(["category loss: level 3 missing"]);
    });

    it("passes the data files in the repository", () => {
        const data = {
            ceos: readData("ceos.json"),
            rubric: readData("rubric.json"),
            statements: readData("statements.json"),
        };

        expect(validate(data)).toEqual([]);
    });
});
