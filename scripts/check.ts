import {readFile} from "node:fs/promises";
import {join} from "node:path";
import type {Ceo, RawStatement, Rubric} from "../src/lib/content.js";
import {DATA_FILES_DIR} from "../src/lib/paths.js";
import {validate} from "../src/lib/statement-rules.js";
import {fetchText, matchQuote} from "../src/lib/quote-check.js";

const FETCH_CONCURRENCY = 6;

const readJson = async <T>(name: string): Promise<T> =>
    JSON.parse(await readFile(join(DATA_FILES_DIR, name), "utf8")) as T;

async function inBatches<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += size) {
        results.push(...(await Promise.all(items.slice(i, i + size).map(task))));
    }
    return results;
}

async function checkPages(statements: RawStatement[]): Promise<string[]> {
    const problems: string[] = [];
    const report = await inBatches(statements, FETCH_CONCURRENCY, async (s) => {
        const page = await fetchText(s.quoteSource);
        const match = matchQuote(s.quote, page);
        let verdict: string;
        let confirmed = false;
        if (match.verdict === "found") {
            verdict = "quote found";
            confirmed = true;
        } else if (s.manualCheck) {
            verdict = `checked by hand ${s.manualCheck.date}`;
            confirmed = true;
        } else if (match.verdict === "unreadable") verdict = `PAGE FAILED (${page.status})`;
        else if (match.verdict === "too short") verdict = "QUOTE TOO SHORT TO MATCH";
        else verdict = `QUOTE NOT FOUND (${match.found}/${match.of} fragments)`;
        if (!confirmed) problems.push(`${s.id}: ${verdict}`);

        const sourcePages = await Promise.all(s.sources.map((source) => fetchText(source.url)));
        const deadSources = s.sources
            .map((source, i) => ({url: source.url, page: sourcePages[i]}))
            .filter(({page}) => !page.ok)
            .map(({url, page}) => `${url} (${page.status})`);
        return {id: s.id, verdict, deadSources};
    });

    for (const row of report) {
        console.log(`${row.verdict.padEnd(40)} ${row.id}`);
        for (const dead of row.deadSources) console.log(`${"".padEnd(40)}   source did not load: ${dead}`);
    }
    return problems;
}

const [ceos, rubric, statements] = await Promise.all([
    readJson<Ceo[]>("ceos.json"),
    readJson<Rubric>("rubric.json"),
    readJson<RawStatement[]>("statements.json"),
]);

const errors = validate({ceos, rubric, statements});
for (const error of errors) console.error(error);
console.log(`${statements.length} statements, ${ceos.length} CEOs, ${errors.length} data errors`);

let problems: string[] = [];
if (process.argv.includes("--fetch")) {
    problems = await checkPages(statements);
    console.log(`${problems.length} quotes not confirmed by their page`);
}
process.exit(errors.length > 0 || problems.length > 0 ? 1 : 0);
