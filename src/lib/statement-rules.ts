import {LEVELS, STRENGTHS, type Ceo, type RawStatement, type Rubric} from "./content.js";
import {isUrl} from "./url.js";

export {isUrl};

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRECISIONS = new Set(["day", "month", "reported"]);

type Rules = {ceos: Ceo[]; rubric: Rubric};

export function isId(value: unknown): boolean {
    return typeof value === "string" && ID_PATTERN.test(value);
}

export function isRealDate(value: unknown): boolean {
    return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

const isText = (value: unknown) => typeof value === "string" && value.trim() !== "";

const WORKING_NOTES = [
    /\bfetch(?:ed|ing)?\b/i,
    /\b(?:page|post|original|article|transcript|episode|video)\b[^.]*\b(?:was|were) not read\b|\bblocked,? not read\b|\bnot read on a page\b/i,
    /(?<![\w-])(?:un)?readable\b/i,
    /\bpaywalled\b/i,
    /\bhttps?\b/i,
    /\b(?:HTTP|error|status)\s*403\b|\(403\)/i,
    /\bpages read\b/i,
    /\b(?:so|for|to|let) the lead\b|\bthe lead (?:can|could|should|may|might|will|would|decides?)\b/i,
    /\b(?:because|so|for|by) the brief\b|\bthe brief (?:covers|says|asks|allows|wants)\b/i,
    /\b(?:so|for|to|let) the owner\b|\bthe owner(?:'s call| can| could| should| may| might| will| would| decides?)\b/i,
    /\balready in the dataset\b/i,
    /\bprimarySource\b/i,
    /(?:^|[.;(]\s*)(?:the )?date is\b/i,
    /\bMild\./,
    /\bWeak\./,
    /\bno (?:[\w']+[\s-]+){0,4}?(?:backlash|outrage|reaction|criticism|coverage|pile-on)\b[^.]*\bwas found\b/i,
];

export function workingNoteErrors(value: unknown): string[] {
    const s = (value ?? {}) as Partial<RawStatement>;
    const fields = {venue: s.venue, context: s.context, "backlash summary": s.backlash?.summary};
    const errors: string[] = [];
    for (const [field, text] of Object.entries(fields)) {
        if (typeof text !== "string") continue;
        for (const pattern of WORKING_NOTES) {
            const match = text.match(pattern);
            if (match) errors.push(`${field} holds a working note ("${match[0]}"), which belongs in notes`);
        }
    }
    return errors;
}

export function statementErrors(value: unknown, {ceos, rubric}: Rules): string[] {
    const s = (value ?? {}) as Partial<Record<keyof RawStatement, any>>;
    const errors: string[] = [];
    const fail = (message: string) => errors.push(message);
    const max = rubric.maxPerCategory;
    const categoryIds = rubric.categories.map((category) => category.id);
    const today = new Date().toISOString().slice(0, 10);

    if (!isId(s.id)) fail("id must be kebab-case");
    if (!ceos.some((ceo) => ceo.id === s.ceo)) fail(`unknown ceo "${s.ceo}"`);
    if (!isRealDate(s.date)) fail("date must be YYYY-MM-DD");
    else if (s.date > today) fail("date is in the future");
    if (!PRECISIONS.has(s.datePrecision)) fail("datePrecision must be day, month or reported");

    for (const field of ["venue", "quote", "context"] as const) {
        if (!isText(s[field])) fail(`${field} missing`);
    }
    if (!s.headline?.text || !s.headline?.outlet || !isUrl(s.headline?.url))
        fail("headline needs text, outlet and url");
    if (!isUrl(s.quoteSource)) fail("quoteSource must be a url");
    if (typeof s.leaked !== "boolean") fail("leaked must be true or false");
    if (!STRENGTHS.includes(s.backlashStrength)) fail(`backlashStrength must be ${STRENGTHS.join(", ")}`);
    if (s.primarySource !== null && !isUrl(s.primarySource?.url)) fail("primarySource must be null or have a url");
    if (!s.backlash?.summary || !isUrl(s.backlash?.url)) fail("backlash needs a summary and a url");

    const sources: any[] = Array.isArray(s.sources) ? s.sources : [];
    if (sources.some((source) => !source?.outlet || !source?.title || !isUrl(source?.url))) {
        fail("every source needs outlet, title and url");
    }
    const outlets = new Set(sources.map((source) => String(source?.outlet).toLowerCase()));
    if (outlets.size < 2) fail("needs sources from at least two different outlets");

    for (const id of categoryIds) {
        const entry = s.scores?.[id];
        if (!Number.isInteger(entry?.score) || entry.score < 0 || entry.score > max) {
            fail(`score for ${id} must be an integer from 0 to ${max}`);
        }
        if (!isText(entry?.reason)) fail(`reason for ${id} missing`);
    }
    for (const id of Object.keys(s.scores ?? {})) {
        if (!categoryIds.includes(id)) fail(`score for unknown category ${id}`);
    }
    if (s.manualCheck !== undefined && (!isRealDate(s.manualCheck?.date) || !s.manualCheck?.note)) {
        fail("manualCheck needs a date and a note");
    }
    if (s.notes !== undefined && typeof s.notes !== "string") fail("notes must be text");
    return errors;
}

export function validate({ceos, rubric, statements}: Rules & {statements: unknown[]}): string[] {
    const errors: string[] = [];
    const fail = (where: string, message: string) => errors.push(`${where}: ${message}`);

    const ceoIds = new Set<string>();
    for (const ceo of ceos) {
        if (!isId(ceo.id)) fail(`ceo ${ceo.id}`, "id must be kebab-case");
        if (ceoIds.has(ceo.id)) fail(`ceo ${ceo.id}`, "duplicate id");
        ceoIds.add(ceo.id);
        for (const field of ["name", "company"] as const) {
            if (typeof ceo[field] !== "string" || ceo[field] === "") fail(`ceo ${ceo.id}`, `${field} missing`);
        }
    }

    const max = rubric.maxPerCategory;
    if (!Number.isInteger(max) || max < 1) fail("rubric", "maxPerCategory must be a positive integer");
    for (const category of rubric.categories) {
        if (!isId(category.id)) fail(`category ${category.id}`, "id must be kebab-case");
        if (typeof category.weight !== "number" || category.weight < 0) {
            fail(`category ${category.id}`, "weight must be a number of 0 or more");
        }
        for (const level of LEVELS) {
            if (typeof category.levels?.[level] !== "string" || category.levels[level] === "") {
                fail(`category ${category.id}`, `level ${level} missing`);
            }
        }
    }

    const statementIds = new Set<string>();
    for (const value of statements) {
        const id = String((value as {id?: unknown})?.id);
        if (statementIds.has(id)) fail(`statement ${id}`, "duplicate id");
        statementIds.add(id);
        for (const message of statementErrors(value, {ceos, rubric})) fail(`statement ${id}`, message);
        for (const message of workingNoteErrors(value)) fail(`statement ${id}`, message);
    }
    return errors;
}
