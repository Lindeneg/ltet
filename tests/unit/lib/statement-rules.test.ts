import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {
    isId,
    isRealDate,
    isUrl,
    statementErrors,
    validate,
    workingNoteErrors,
} from "../../../src/lib/statement-rules.js";
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

describe("working notes", () => {
    const inContext = (context: string) => workingNoteErrors(makeStatement({context}));

    it("takes notes that are absent, empty or text and refuses anything else", () => {
        expect(statementErrors(makeStatement(), rules)).toEqual([]);
        expect(statementErrors(makeStatement({notes: ""}), rules)).toEqual([]);
        expect(statementErrors(makeStatement({notes: "The FT page was paywalled."}), rules)).toEqual([]);
        expect(statementErrors({...makeStatement(), notes: 3}, rules)).toEqual(["notes must be text"]);
    });

    it("finds notes on fetching and reading pages", () => {
        for (const text of [
            "The CBS page returned an error to the fetch.",
            "The keynote video was not fetched.",
            "The post itself was not read.",
            "Neowin ran a headline (page blocked, not read).",
            "The NYT page was not fetched (403).",
            "The original post was not readable.",
            "The FT original is paywalled.",
            "The WSJ article (https://www.wsj.com/a) ran first.",
            "The page failed with HTTP 403.",
            "No backlash was documented in the pages read.",
        ]) {
            expect(inContext(text), text).not.toEqual([]);
        }
    });

    it("finds asides to the people reviewing it", () => {
        for (const text of [
            "Included so the lead can decide.",
            "Included because the brief covers jobs.",
            "The owner's call is to include it.",
            "The 2024 interview is already in the dataset.",
            "No video was reachable, so primarySource is null.",
        ]) {
            expect(inContext(text), text).not.toEqual([]);
        }
    });

    it("finds notes on how the date was chosen", () => {
        expect(inContext("Date is the report date.")).not.toEqual([]);
        expect(inContext("The date is the first coverage seen.")).not.toEqual([]);
    });

    it("finds grades of the reaction", () => {
        for (const text of [
            "Mild. Fox News quoted experts.",
            "Weak. Futurism frames it.",
            "No backlash was found.",
            "No broad public backlash was found.",
        ]) {
            expect(inContext(text), text).not.toEqual([]);
        }
    });

    it("names the field and the phrase", () => {
        const statement = makeStatement({venue: "Fetched from X", backlash: {summary: "Mild.", url: "https://a.b"}});

        expect(workingNoteErrors(statement)).toEqual([
            'venue holds a working note ("Fetched"), which belongs in notes',
            'backlash summary holds a working note ("Mild."), which belongs in notes',
        ]);
    });

    it("leaves public prose that only resembles a note alone", () => {
        for (const text of [
            "404 Media reported it first.",
            "Critics feared a paywall for thinking.",
            "An agent broke into Hugging Face datasets.",
            "Nvidia took the lead in AI chips.",
            "Musk, the owner of X, posted it.",
            "The reaction was mild.",
            "Nvidia took the lead.",
            "Altman, the lead investor, spoke.",
            "The owner, Musk, said it on X.",
            "The launch date is Friday.",
            "Regulators want machine-readable labels.",
            "A vulnerability was found in the model.",
            "Musk said he had not read the bill.",
            "No court was found to have jurisdiction.",
            "There was no doubt the remark was found offensive.",
            "Intel cut 403 jobs.",
            "Meta scraped the dataset without consent.",
        ]) {
            expect(inContext(text), text).toEqual([]);
        }
    });

    it("lints only the venue, the context and the backlash summary", () => {
        const statement = makeStatement({
            quote: "We fetched the dataset and the lead was not readable",
            headline: {text: "Paywalled: the owner speaks", outlet: "404 Media", url: "https://a.example"},
            notes: "Not fetched, HTTP 403. Mild.",
        });

        expect(workingNoteErrors(statement)).toEqual([]);
    });

    it("counts working notes as data errors in the check", () => {
        const statement = makeStatement({context: "Date is the report date."});

        expect(validate({...rules, statements: [statement]})).toEqual([
            `statement ${statement.id}: context holds a working note ("Date is"), which belongs in notes`,
        ]);
    });
});
