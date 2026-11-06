import {vi} from "vitest";
import type LoggerService from "../../src/services/logger-service.js";
import type ContentService from "../../src/services/content-service.js";
import type {Category, Ceo, Content, RawStatement, Rubric} from "../../src/lib/content.js";
import type {User, UserWithPassword} from "../../src/repositories/user-repository.js";
import type {StatementRecord} from "../../src/repositories/statement-repository.js";
import type {ProposalRecord} from "../../src/repositories/proposal-repository.js";
import type {RunRecord} from "../../src/repositories/run-repository.js";

// classes with private members can't be satisfied structurally, so fakes are cast
export function fake<T>(impl: object): T {
    return impl as T;
}

export function fakeLog() {
    return fake<LoggerService>({
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
    });
}

export function makeCeo(overrides: Partial<Ceo> = {}): Ceo {
    return {id: "altman", name: "Sam Altman", company: "OpenAI", ...overrides};
}

export function makeLevels(name: string): Category["levels"] {
    return {0: `${name} none`, 1: `${name} a trace`, 3: `${name} clear`, 5: `${name} at worst`};
}

export function makeRubric(overrides: Partial<Rubric> = {}): Rubric {
    const award = {name: "Award", for: "for something"};
    return {
        maxPerCategory: 5,
        unit: {one: "pitchfork", many: "pitchforks"},
        categories: [
            {id: "loss", name: "What you'll lose", question: "Loss?", levels: makeLevels("Loss"), weight: 1, award},
            {id: "doom", name: "Doom", question: "Doom?", levels: makeLevels("Doom"), weight: 2, award},
        ],
        titles: {first: "Marie Antoinette of the Year", last: "The Control Group", topStatement: award},
        ...overrides,
    };
}

export function makeContent(overrides: Partial<Content> = {}): Content {
    return {
        ceos: [makeCeo(), makeCeo({id: "musk", name: "Elon Musk", company: "xAI"})],
        rubric: makeRubric(),
        ...overrides,
    };
}

export function makeContentService(content: Content = makeContent()): ContentService {
    return fake<ContentService>({get: () => content});
}

export function makeStatement(overrides: Partial<RawStatement> = {}, scores = {loss: 3, doom: 1}): RawStatement {
    return {
        id: "altman-2025-09-01-statement",
        ceo: "altman",
        date: "2025-09-01",
        datePrecision: "day",
        venue: "An interview",
        leaked: false,
        headline: {text: "A headline", outlet: "Outlet One", url: "https://one.example/a"},
        quote: "These are the exact words that were said in public",
        quoteSource: "https://one.example/a",
        primarySource: null,
        context: "Some context.",
        sources: [
            {outlet: "Outlet One", title: "A headline", url: "https://one.example/a"},
            {outlet: "Outlet Two", title: "Another", url: "https://two.example/b"},
        ],
        backlash: {summary: "People were upset.", url: "https://two.example/b"},
        backlashStrength: "outrage",
        topics: ["jobs"],
        scores: {
            loss: {score: scores.loss, reason: "A reason."},
            doom: {score: scores.doom, reason: "A reason."},
        },
        ...overrides,
    };
}

export function makeUser(overrides: Partial<User> = {}): User {
    return {
        id: "user-1",
        email: "admin@example.com",
        name: "Ada Lovelace",
        role: "ADMIN",
        tokenVersion: 0,
        createdAt: new Date("2025-09-01T12:00:00Z"),
        ...overrides,
    };
}

export function makeUserWithPassword(password: string, overrides: Partial<User> = {}): UserWithPassword {
    return {...makeUser(overrides), password};
}

export function makeStatementRecord(overrides: Partial<StatementRecord> = {}): StatementRecord {
    const body = overrides.body ?? makeStatement();
    return {
        id: body.id,
        ceo: body.ceo,
        date: body.date,
        body,
        published: true,
        origin: "seed",
        createdAt: new Date("2025-09-01T12:00:00Z"),
        updatedAt: new Date("2025-09-02T12:00:00Z"),
        ...overrides,
    };
}

export function makeProposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
    return {
        id: 1,
        kind: "statement",
        status: "open",
        origin: "scout",
        statementId: makeStatement().id,
        body: makeStatement(),
        checks: null,
        runId: null,
        note: null,
        createdAt: new Date("2025-09-01T12:00:00Z"),
        decidedAt: null,
        ...overrides,
    };
}

export function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
        id: 1,
        status: "ok",
        summary: {since: "2025-08-31", proposed: 1, dropped: 2, failed: 0, costUsd: 0.42},
        log: "a line\nanother line",
        outcomes: null,
        startedAt: new Date("2025-09-01T03:00:00Z"),
        finishedAt: new Date("2025-09-01T03:10:00Z"),
        startedBy: "schedule",
        dryRun: false,
        pid: null,
        ...overrides,
    };
}
