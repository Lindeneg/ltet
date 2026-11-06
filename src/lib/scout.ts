import {
    LEVELS,
    STRENGTHS,
    type Category,
    type Ceo,
    type DatePrecision,
    type RawStatement,
    type Rubric,
} from "./content.js";
import {headlineOnPage, matchQuote, normalize, type QuoteMatch} from "./quote-check.js";
import type {ScoredStatement} from "./score.js";
import type {PageLoader} from "./pages.js";
import type {MaybeNull} from "./types.js";

export const RECORD_START_DAY = "2022-11-30";
const EXAMPLES = 16;
const NEAREST = 4;
const MIN_TOPIC_WORD = 5;
const DUPLICATE_OVERLAP = 0.3;
const SHINGLE_WORDS = 6;
export const VERIFIED_PAGES = 2;

export function formatCost(usd: number): string {
    return `$${usd.toFixed(2)}`;
}

export type Lead = {
    ceo: string;
    words: string;
    date: string;
    datePrecision: DatePrecision;
    venue: string;
    leaked: boolean;
    quoteSource: string;
    sourceUrls: string[];
    headlineUrl: string;
    backlashUrl: string;
    backlashStrength: string;
    why: string;
    suggestion: number;
};

export type SuggestionOutcome = {id: number; qualifies: boolean; finding: string};

export type FindOutput = {leads: Lead[]; suggestionOutcomes: SuggestionOutcome[]; searched: string};

export type WriteResult = {lead: number; keep: boolean; dropReason: string; statement: RawStatement | null};

export type WriteOutput = {results: WriteResult[]};

export type ProposedOutcome = {
    statementId: string;
    ceo: string;
    headline: string;
    verified: boolean;
    foundOn: number;
    forks: number;
    proposalId: MaybeNull<number>;
};

export type MissedOutcome = {
    kind: "dropped" | "duplicate" | "failed";
    ceo: string;
    date: string;
    venue: string;
    statementId: MaybeNull<string>;
    reason: string;
};

export type ResearchedOutcome = {
    id: number;
    url: string;
    qualifies: boolean;
    finding: string;
    proposalId: MaybeNull<number>;
};

export type RunOutcomes = {proposed: ProposedOutcome[]; missed: MissedOutcome[]; suggestions: ResearchedOutcome[]};

export type Checks = {
    quotePages: (QuoteMatch & {url: string})[];
    foundOn: number;
    verified: boolean;
    headlineFound: boolean;
};

export const day = (date: Date) => date.toISOString().slice(0, 10);

export const daysBefore = (iso: string, days: number) => day(new Date(Date.parse(iso) - days * 86_400_000));

export const fill = (text: string, values: Record<string, string>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key]);

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

export function sameStatement(a: RawStatement, b: RawStatement): boolean {
    if (a.ceo !== b.ceo) return false;
    const runs = (quote: string) => {
        const words = normalize(quote).split(" ");
        return new Set(
            words
                .slice(0, Math.max(1, words.length - SHINGLE_WORDS + 1))
                .map((_, i) => words.slice(i, i + SHINGLE_WORDS).join(" "))
        );
    };
    const mine = runs(a.quote);
    const theirs = runs(b.quote);
    const shared = [...mine].filter((run) => theirs.has(run)).length;
    return (
        shared / Math.min(mine.size, theirs.size) >= DUPLICATE_OVERLAP ||
        (a.date === b.date && a.headline?.url === b.headline?.url)
    );
}

export function uniqueId(id: unknown, taken: Set<string>): string {
    const base =
        String(id)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "statement";
    let candidate = base;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
    return candidate;
}

export function rubricLines(c: Category): string {
    return [
        `- \`${c.id}\` ${c.name}: ${c.question}`,
        ...LEVELS.map((level) => `  - ${level}: ${c.levels[level]}`),
    ].join("\n");
}

export function example(s: ScoredStatement): string {
    return JSON.stringify({
        who: s.who.name,
        quote: s.quote,
        context: s.context,
        backlashStrength: s.backlashStrength,
        pitchforks: s.forks,
        scores: s.scores,
    });
}

export function spread(scored: ScoredStatement[]): ScoredStatement[] {
    const byForks = [...scored].sort((a, b) => a.forks - b.forks);
    return [
        ...new Set(
            Array.from({length: EXAMPLES}, (_, i) => byForks[Math.round((i * (byForks.length - 1)) / (EXAMPLES - 1))])
        ),
    ];
}

export function nearest(scored: ScoredStatement[], text: string): ScoredStatement[] {
    const words = (value: string) =>
        new Set(
            normalize(value)
                .split(" ")
                .filter((w) => w.length >= MIN_TOPIC_WORD)
        );
    const mine = words(text);
    return scored
        .map((s) => ({s, shared: [...words(`${s.quote} ${s.context} ${s.venue}`)].filter((w) => mine.has(w)).length}))
        .sort((a, b) => b.shared - a.shared)
        .slice(0, NEAREST)
        .map(({s}) => s);
}

export async function verify(statement: RawStatement, load: PageLoader): Promise<Checks> {
    const urls = [...new Set([statement.quoteSource, ...statement.sources.map((s) => s.url)])];
    const pages = await Promise.all(urls.map(async (url) => ({url, ...matchQuote(statement.quote, await load(url))})));
    const hosts = new Set(pages.filter((p) => p.verdict === "found").map((p) => hostOf(p.url)));
    return {
        quotePages: pages,
        foundOn: hosts.size,
        verified: hosts.size >= VERIFIED_PAGES,
        headlineFound: headlineOnPage(statement.headline.text, await load(statement.headline.url)),
    };
}

const url = {type: "string"};

export function findSchema(ceos: Ceo[]) {
    return {
        type: "object",
        additionalProperties: false,
        required: ["leads", "suggestionOutcomes", "searched"],
        properties: {
            leads: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                        "ceo",
                        "words",
                        "date",
                        "datePrecision",
                        "venue",
                        "leaked",
                        "quoteSource",
                        "sourceUrls",
                        "headlineUrl",
                        "backlashUrl",
                        "backlashStrength",
                        "why",
                        "suggestion",
                    ],
                    properties: {
                        ceo: {type: "string", enum: ceos.map((c) => c.id)},
                        words: {type: "string"},
                        date: {type: "string"},
                        datePrecision: {type: "string", enum: ["day", "month", "reported"]},
                        venue: {type: "string"},
                        leaked: {type: "boolean"},
                        quoteSource: url,
                        sourceUrls: {type: "array", items: url},
                        headlineUrl: url,
                        backlashUrl: url,
                        backlashStrength: {type: "string", enum: STRENGTHS},
                        why: {type: "string"},
                        suggestion: {type: "integer", description: "the suggestion number this lead answers, or 0"},
                    },
                },
            },
            suggestionOutcomes: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "qualifies", "finding"],
                    properties: {id: {type: "integer"}, qualifies: {type: "boolean"}, finding: {type: "string"}},
                },
            },
            searched: {type: "string"},
        },
    };
}

export function writeSchema(ceos: Ceo[], rubric: Rubric) {
    const score = {
        type: "object",
        additionalProperties: false,
        required: ["score", "reason"],
        properties: {score: {type: "integer", minimum: 0, maximum: rubric.maxPerCategory}, reason: {type: "string"}},
    };
    return {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: {
            results: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["lead", "keep", "dropReason", "statement"],
                    properties: {
                        lead: {type: "integer"},
                        keep: {type: "boolean"},
                        dropReason: {type: "string"},
                        statement: {
                            anyOf: [
                                {type: "null"},
                                {
                                    type: "object",
                                    additionalProperties: false,
                                    required: [
                                        "id",
                                        "ceo",
                                        "date",
                                        "datePrecision",
                                        "venue",
                                        "leaked",
                                        "headline",
                                        "quote",
                                        "quoteSource",
                                        "primarySource",
                                        "context",
                                        "sources",
                                        "backlash",
                                        "backlashStrength",
                                        "topics",
                                        "scores",
                                    ],
                                    properties: {
                                        id: {type: "string"},
                                        ceo: {type: "string", enum: ceos.map((c) => c.id)},
                                        date: {type: "string"},
                                        datePrecision: {type: "string", enum: ["day", "month", "reported"]},
                                        venue: {type: "string"},
                                        leaked: {type: "boolean"},
                                        headline: {
                                            type: "object",
                                            additionalProperties: false,
                                            required: ["text", "outlet", "url"],
                                            properties: {text: {type: "string"}, outlet: {type: "string"}, url},
                                        },
                                        quote: {type: "string"},
                                        quoteSource: url,
                                        primarySource: {
                                            anyOf: [
                                                {type: "null"},
                                                {
                                                    type: "object",
                                                    additionalProperties: false,
                                                    required: ["url", "kind"],
                                                    properties: {url, kind: {type: "string"}},
                                                },
                                            ],
                                        },
                                        context: {type: "string"},
                                        sources: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                additionalProperties: false,
                                                required: ["outlet", "title", "url"],
                                                properties: {
                                                    outlet: {type: "string"},
                                                    title: {type: "string"},
                                                    url,
                                                    date: {type: "string"},
                                                },
                                            },
                                        },
                                        backlash: {
                                            type: "object",
                                            additionalProperties: false,
                                            required: ["summary", "url"],
                                            properties: {summary: {type: "string"}, url},
                                        },
                                        backlashStrength: {type: "string", enum: STRENGTHS},
                                        topics: {type: "array", items: {type: "string"}},
                                        scores: {
                                            type: "object",
                                            additionalProperties: false,
                                            required: rubric.categories.map((c) => c.id),
                                            properties: Object.fromEntries(rubric.categories.map((c) => [c.id, score])),
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        },
    };
}
