import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {DATA_FILES_DIR} from "./paths.js";
import type {MaybeNull} from "./types.js";

export type Photo = {
    file: string;
    author: string;
    licence: string;
    licenceUrl?: string;
    source: string;
    changes: string;
};

export type Ceo = {
    id: string;
    name: string;
    company: string;
    photo?: Photo;
};

export type Award = {name: string; for: string};

export const LEVELS = [0, 1, 3, 5] as const;

export type Level = (typeof LEVELS)[number];

export type Category = {
    id: string;
    name: string;
    question: string;
    levels: Record<Level, string>;
    weight: number;
    award: Award;
};

export type Rubric = {
    maxPerCategory: number;
    unit: {one: string; many: string};
    categories: Category[];
    titles: {first: string; last: string; topStatement: Award};
};

export const STRENGTHS = ["outrage", "widespread criticism", "critical commentary"] as const;

export type BacklashStrength = (typeof STRENGTHS)[number];

export type DatePrecision = "day" | "month" | "reported";

export type Score = {score: number; reason: string};

export type Source = {outlet: string; title: string; url: string; date?: string};

export type RawStatement = {
    id: string;
    ceo: string;
    date: string;
    datePrecision: DatePrecision;
    venue: string;
    leaked: boolean;
    headline: {text: string; outlet: string; url: string};
    quote: string;
    quoteSource: string;
    primarySource: MaybeNull<{url: string; kind: string}>;
    context: string;
    sources: Source[];
    backlash: {summary: string; url: string};
    backlashStrength: BacklashStrength;
    topics?: string[];
    scores: Record<string, Score>;
    manualCheck?: {date: string; note: string};
};

export type Content = {ceos: Ceo[]; rubric: Rubric};

async function readJson<T>(name: string): Promise<T> {
    return JSON.parse(await readFile(join(DATA_FILES_DIR, name), "utf8")) as T;
}

export async function loadContent(): Promise<Content> {
    const [ceos, rubric] = await Promise.all([readJson<Ceo[]>("ceos.json"), readJson<Rubric>("rubric.json")]);
    return {ceos, rubric};
}

export function readSeed(): Promise<RawStatement[]> {
    return readJson<RawStatement[]>("statements.json");
}
