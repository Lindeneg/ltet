import {spawnSync} from "node:child_process";
import {mkdirSync, rmSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {loadSeedEnv} from "../src/lib/env.js";
import {loadContent, readSeed, type RawStatement} from "../src/lib/content.js";
import {quoteFragments} from "../src/lib/quote-check.js";
import {hostOf, VERIFIED_PAGES} from "../src/lib/scout.js";
import {tally} from "../src/lib/score.js";
import LoggerService from "../src/services/logger-service.js";
import DataService from "../src/services/data-service.js";
import SeedService from "../src/services/seed-service.js";
import SeedRepository from "../src/repositories/seed-repository.js";
import StatementRepository from "../src/repositories/statement-repository.js";
import UserRepository from "../src/repositories/user-repository.js";
import ContenderRepository from "../src/repositories/contender-repository.js";
import RubricRepository from "../src/repositories/rubric-repository.js";
import {photosDir, SEED_PHOTOS_DIR} from "../src/lib/paths.js";

const DEV_ADMIN = {email: "dev@example.com", name: "Dev Admin", password: "development"};
const MODEL = "opus";
const SCHEDULE = "schedule";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const env = loadSeedEnv();
if (env.NODE_ENV !== "development") {
    console.error("seed:dev only runs with NODE_ENV=development.");
    process.exit(1);
}
if (!env.SUPER_USER) {
    console.error("SUPER_USER must be set, as email,firstname,lastname,password.");
    process.exit(1);
}

const file = resolve(env.DATABASE_URL.replace(/^file:/, ""));
for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, {force: true});
rmSync(photosDir(env.DATABASE_URL), {recursive: true, force: true});
mkdirSync(dirname(file), {recursive: true});
console.log(`Reset the database at ${file} and its photo store.`);
const migrate = spawnSync("npx prisma migrate deploy", {shell: true, stdio: "inherit"});
if (migrate.status !== 0) {
    console.error(`Failed: prisma migrate deploy ${migrate.error?.message ?? `exited with ${migrate.status}`}`);
    process.exit(1);
}

const dataService = new DataService(env.DATABASE_URL, "production", new LoggerService("production"));
const seedRepo = new SeedRepository(dataService);
const seeder = new SeedService({
    seedRepo,
    statementRepo: new StatementRepository(dataService),
    userRepo: new UserRepository(dataService),
    contenderRepo: new ContenderRepository(dataService),
    rubricRepo: new RubricRepository(dataService),
    photosDir: photosDir(env.DATABASE_URL),
    seedPhotosDir: SEED_PHOTOS_DIR,
    bcryptRounds: env.BCRYPT_ROUNDS,
    print: (line) => console.log(line),
});

function must<T>(result: {ok: true; data: T} | {ok: false; ctx: unknown}, label: string): T {
    if (!result.ok) throw new Error(`${label}: ${String(result.ctx)}`);
    return result.data;
}

const at = (iso: string) => new Date(iso);
const later = (date: Date, ms: number) => new Date(date.getTime() + ms);

const seed = await readSeed();
const content = await loadContent();
const byId = (id: string) => {
    const statement = seed.find((s) => s.id === id);
    if (!statement) throw new Error(`the seed has no statement ${id}`);
    return statement;
};
const forks = (s: RawStatement) => tally(content.ceos, content.rubric, [s]).statements[0].forks;

function checks(s: RawStatement, unreadable: string[] = []) {
    const of = quoteFragments(s.quote).length;
    const urls = [...new Set([s.quoteSource, ...s.sources.map((source) => source.url)])];
    const quotePages = urls.map((url) =>
        unreadable.includes(url)
            ? {url, verdict: "unreadable", found: 0, of, status: 403}
            : {url, verdict: "found", found: of, of}
    );
    const foundOn = new Set(quotePages.filter((p) => p.verdict === "found").map((p) => hostOf(p.url))).size;
    return {
        quotePages,
        foundOn,
        verified: foundOn >= VERIFIED_PAGES,
        headlineFound: !unreadable.includes(s.headline.url),
    };
}

function summary(since: string, counts: Partial<Record<string, number>> = {}) {
    return {
        since,
        model: MODEL,
        leads: 0,
        written: 0,
        proposed: 0,
        verified: 0,
        onePage: 0,
        dropped: 0,
        duplicates: 0,
        failed: 0,
        suggestions: 0,
        costUsd: 0,
        ...counts,
    };
}

const proposedOutcome = (s: RawStatement, c: ReturnType<typeof checks>, proposalId: number | null) => ({
    statementId: s.id,
    ceo: s.ceo,
    headline: s.headline.text,
    verified: c.verified,
    foundOn: c.foundOn,
    forks: forks(s),
    proposalId,
});

const noOutcomes = {proposed: [], missed: [], suggestions: []};

const proposedLine = (s: RawStatement, foundOn: number) =>
    `Proposed: ${s.id}, ${forks(s)} ${content.rubric.unit.many}, quote on ${foundOn} site(s).`;

const doneLine = (s: ReturnType<typeof summary>) =>
    `Done: ${s.proposed} proposed (${s.verified} verified on ${VERIFIED_PAGES}+ sites, ${s.onePage} on one), ${s.dropped} dropped, ${s.duplicates} duplicates, ${s.failed} failed checks. Cost estimate $${s.costUsd} (subscription usage, not a bill).`;

try {
    must(await seeder.min(env.SUPER_USER, {...content, statements: seed}), "seeding the minimum");

    const approved = byId("amodei-2026-09-agrees-with-coxon-ai-could-kill-us-all");
    const rejected = byId("huang-2026-09-klein-basic-math-does-it-matter");
    const verified = byId("altman-2026-10-ram");
    const onePage = byId("musk-2026-10-saving-money-pointless");
    const heldBack = [rejected, verified, onePage];
    must(await seedRepo.removeStatements(heldBack.map((s) => s.id)), "holding statements back");
    console.log(`Held back ${heldBack.length} statements for the scout's proposals.`);

    const runOneAt = at("2026-09-15T05:00:00Z");
    const runOne = summary("2026-09-01", {
        leads: 2,
        written: 2,
        proposed: 1,
        verified: 1,
        duplicates: 1,
        costUsd: 0.94,
    });
    const approvedChecks = checks(approved);
    const runOneId = must(
        await seedRepo.addRun({
            status: "ok",
            startedBy: SCHEDULE,
            summary: runOne,
            startedAt: runOneAt,
            finishedAt: later(runOneAt, 6 * MINUTE),
            log: [
                `Scout run 1: statements since 2026-09-01, model ${MODEL}.`,
                "Find: 2 leads in 11 turns. Searched: interviews, keynotes and posts by the contenders since 1 September.",
                "Duplicate: pichai-2026-05-boo-strategy repeats pichai-2026-05-hard-fork-boo-strategy.",
                proposedLine(approved, approvedChecks.foundOn),
                doneLine(runOne),
            ].join("\n"),
        }),
        "adding run 1"
    );
    const approvedAt = at("2026-09-15T19:12:00Z");
    const approvedProposal = must(
        await seedRepo.addProposal({
            kind: "statement",
            status: "approved",
            origin: "scout",
            statementId: approved.id,
            body: approved,
            checks: approvedChecks,
            runId: runOneId,
            createdAt: later(runOneAt, 5 * MINUTE),
            decidedAt: approvedAt,
        }),
        "adding the approved proposal"
    );
    must(
        await seedRepo.setOutcomes(runOneId, {
            proposed: [proposedOutcome(approved, approvedChecks, approvedProposal)],
            missed: [
                {
                    kind: "duplicate",
                    ceo: "pichai",
                    date: "2026-05-20",
                    venue: "Hard Fork",
                    statementId: "pichai-2026-05-boo-strategy",
                    reason: "repeats pichai-2026-05-hard-fork-boo-strategy",
                },
            ],
            suggestions: [],
        }),
        "adding run 1's outcomes"
    );
    must(await seedRepo.setOrigin(approved.id, "scout", approvedAt), "marking the approved statement");

    const runTwoAt = at("2026-09-26T05:00:00Z");
    const runTwo = summary("2026-09-12", {leads: 1, written: 1, proposed: 1, verified: 1, costUsd: 1.12});
    const rejectedChecks = checks(rejected);
    const runTwoId = must(
        await seedRepo.addRun({
            status: "ok",
            startedBy: SCHEDULE,
            summary: runTwo,
            startedAt: runTwoAt,
            finishedAt: later(runTwoAt, 5 * MINUTE),
            log: [
                `Scout run 2: statements since 2026-09-12, model ${MODEL}.`,
                "Find: 1 leads in 9 turns. Searched: interviews, keynotes and posts by the contenders since 12 September.",
                proposedLine(rejected, rejectedChecks.foundOn),
                doneLine(runTwo),
            ].join("\n"),
        }),
        "adding run 2"
    );
    must(
        await seedRepo.addProposal({
            kind: "statement",
            status: "rejected",
            origin: "scout",
            statementId: rejected.id,
            body: rejected,
            checks: rejectedChecks,
            runId: runTwoId,
            note: "Held for a second look at the scores.",
            createdAt: later(runTwoAt, 4 * MINUTE),
            decidedAt: at("2026-09-27T08:30:00Z"),
        }),
        "adding the rejected proposal"
    );

    const runThreeAt = at("2026-10-30T05:00:00Z");
    const runThreeId = must(
        await seedRepo.addRun({
            status: "failed",
            startedBy: SCHEDULE,
            summary: summary("2026-09-23"),
            startedAt: runThreeAt,
            finishedAt: later(runThreeAt, 45 * MINUTE),
            log: [
                `Scout run 3: statements since 2026-09-23, model ${MODEL}.`,
                "Failed: claude ran past 45 minutes",
            ].join("\n"),
        }),
        "adding run 3"
    );
    must(await seedRepo.setOutcomes(runThreeId, noOutcomes), "adding run 3's outcomes");

    const runFourAt = at("2026-10-30T09:15:00Z");
    const runFourId = must(
        await seedRepo.addRun({
            status: "stopped",
            startedBy: DEV_ADMIN.email,
            summary: summary("2026-09-23"),
            startedAt: runFourAt,
            finishedAt: later(runFourAt, 3 * MINUTE),
            log: [`Scout run 4: statements since 2026-09-23, model ${MODEL}.`, "Stopped."].join("\n"),
        }),
        "adding run 4"
    );
    must(await seedRepo.setOutcomes(runFourId, noOutcomes), "adding run 4's outcomes");

    const runFiveAt = at("2026-10-30T09:30:00Z");
    const runFive = summary("2026-09-23", {
        leads: 2,
        written: 1,
        proposed: 1,
        verified: 1,
        dropped: 1,
        costUsd: 0.41,
    });
    const verifiedChecks = checks(verified);
    const dropReason = "The remark is about chip export rules, which is general politics, not an AI or tech statement.";
    const runFiveId = must(
        await seedRepo.addRun({
            status: "ok",
            startedBy: DEV_ADMIN.email,
            dryRun: true,
            summary: runFive,
            startedAt: runFiveAt,
            finishedAt: later(runFiveAt, 4 * MINUTE),
            log: [
                `Scout run 5: statements since 2026-09-23, model ${MODEL}.`,
                "Find: 2 leads in 12 turns. Searched: interviews, keynotes and posts by the contenders since 23 September.",
                `Dropped: huang, 2026-10-22, CNBC: ${dropReason}`,
                proposedLine(verified, verifiedChecks.foundOn),
                JSON.stringify(verified, null, 2),
                doneLine(runFive),
            ].join("\n"),
        }),
        "adding run 5"
    );
    must(
        await seedRepo.setOutcomes(runFiveId, {
            proposed: [proposedOutcome(verified, verifiedChecks, null)],
            missed: [
                {
                    kind: "dropped",
                    ceo: "huang",
                    date: "2026-10-22",
                    venue: "CNBC",
                    statementId: null,
                    reason: dropReason,
                },
            ],
            suggestions: [],
        }),
        "adding run 5's outcomes"
    );

    const runSixAt = at("2026-10-30T17:00:00Z");
    const runSix = summary("2026-09-23", {costUsd: 0.38});
    const runSixId = must(
        await seedRepo.addRun({
            status: "ok",
            startedBy: DEV_ADMIN.email,
            summary: runSix,
            startedAt: runSixAt,
            finishedAt: later(runSixAt, 4 * MINUTE),
            log: [
                `Scout run 6: statements since 2026-09-23, model ${MODEL}.`,
                "Find: 0 leads in 6 turns. Searched: interviews, keynotes and posts by the contenders since 23 September.",
                doneLine(runSix),
            ].join("\n"),
        }),
        "adding run 6"
    );
    must(await seedRepo.setOutcomes(runSixId, noOutcomes), "adding run 6's outcomes");

    const runSevenAt = at("2026-10-31T05:00:00Z");
    const runSeven = summary("2026-09-23", {
        leads: 3,
        written: 3,
        proposed: 2,
        failed: 1,
        verified: 1,
        onePage: 1,
        suggestions: 1,
        costUsd: 1.31,
    });
    const failedReason =
        'headline "Zuckerberg says the metaverse was never the point" was not found on https://news.example/zuckerberg-metaverse-never-the-point-interview-transcript-and-full-remarks-from-the-evening-session; the quote was not found word for word on any page that loaded';
    const onePageChecks = checks(onePage, [onePage.sources[0].url]);
    const runSevenId = must(
        await seedRepo.addRun({
            status: "ok",
            startedBy: SCHEDULE,
            summary: runSeven,
            startedAt: runSevenAt,
            finishedAt: later(runSevenAt, 7 * MINUTE),
            log: [
                `Scout run 7: statements since 2026-09-23, model ${MODEL}.`,
                "Find: 3 leads in 14 turns. Searched: interviews, keynotes and posts by the contenders since 23 September.",
                proposedLine(verified, verifiedChecks.foundOn),
                `${proposedLine(onePage, onePageChecks.foundOn).slice(0, -1)}, headline not found on its page.`,
                `Failed checks: zuckerberg-2026-10-metaverse-never-the-point: ${failedReason}`,
                doneLine(runSeven),
            ].join("\n"),
        }),
        "adding run 7"
    );
    const runSevenProposed = [];
    for (const [s, c] of [
        [verified, verifiedChecks],
        [onePage, onePageChecks],
    ] as const) {
        const proposalId = must(
            await seedRepo.addProposal({
                kind: "statement",
                status: "open",
                origin: "scout",
                statementId: s.id,
                body: s,
                checks: c,
                runId: runSevenId,
                createdAt: later(runSevenAt, 6 * MINUTE),
            }),
            "adding an open proposal"
        );
        runSevenProposed.push(proposedOutcome(s, c, proposalId));
    }

    must(
        await seedRepo.addRun({
            status: "running",
            startedBy: SCHEDULE,
            summary: null,
            startedAt: new Date(Date.now() - 10 * MINUTE),
            log: `Scout run 8: statements since 2026-10-28, model ${MODEL}.`,
        }),
        "adding run 8"
    );

    const published = seed.filter((s) => !heldBack.includes(s));
    const picks = published.filter((_, i) => i % 12 === 3).slice(0, 8);
    for (const [i, s] of picks.entries()) {
        const changedAt = at(`2026-10-${String(2 + i * 3).padStart(2, "0")}T14:00:00Z`);
        if (i < 3) {
            const category = content.rubric.categories.find((c) => s.scores[c.id].score < 5)!;
            const now = s.scores[category.id].score;
            must(
                await seedRepo.addHistory({
                    statementId: s.id,
                    body: {...s, scores: {...s.scores, [category.id]: {...s.scores[category.id], score: now + 1}}},
                    published: true,
                    note: `${category.name} from ${now + 1} to ${now}, after a dispute.`,
                    changedAt,
                }),
                "adding a score change"
            );
        } else if (i < 6 && s.sources.length > 2) {
            must(
                await seedRepo.addHistory({
                    statementId: s.id,
                    body: {...s, sources: s.sources.slice(0, -1)},
                    published: true,
                    note: `Added ${s.sources.at(-1)!.outlet} as a source.`,
                    changedAt,
                }),
                "adding a source change"
            );
        } else {
            must(
                await seedRepo.addHistory({
                    statementId: s.id,
                    body: s,
                    published: true,
                    note: "Hidden while the date is checked.",
                    changedAt,
                }),
                "adding a hide"
            );
            must(
                await seedRepo.addHistory({
                    statementId: s.id,
                    body: s,
                    published: false,
                    note: "Date checked, back on the site.",
                    changedAt: later(changedAt, 3 * HOUR),
                }),
                "adding a show"
            );
        }
    }

    const disputed = published.filter((_, i) => i % 12 === 9).slice(0, 5);
    const disputes = [
        {
            category: "doom",
            direction: "more",
            comment: "This one should count for more doom. Read the whole answer, not just the quote.",
            status: "open",
        },
        {
            category: "condescension",
            direction: "fewer",
            comment: "Feels harsh for condescension. One fewer, at least.",
            status: "open",
        },
        {
            category: "loss",
            direction: "more",
            comment: "Too low for loss, in my view.",
            status: "done",
            note: "Score changed.",
        },
        {
            category: "hypocrisy",
            direction: "more",
            comment: "More for hypocrisy, surely.",
            status: "done",
            note: "Score changed.",
        },
        {
            category: "tone-deafness",
            direction: "fewer",
            comment: "Tone deaf, yes, but not this tone deaf.",
            status: "rejected",
            note: "The score stands.",
        },
    ] as const;
    for (const [i, d] of disputes.entries()) {
        const createdAt = at(`2026-10-${String(10 + i * 4).padStart(2, "0")}T09:30:00Z`);
        must(
            await seedRepo.addProposal({
                kind: "dispute",
                status: d.status,
                origin: "visitor",
                statementId: disputed[i].id,
                body: {category: d.category, direction: d.direction, comment: d.comment},
                note: "note" in d ? d.note : null,
                createdAt,
                decidedAt: d.status === "open" ? null : later(createdAt, 26 * HOUR),
            }),
            "adding a dispute"
        );
    }

    const suggestions = [
        {
            body: {
                url: "https://news.example/keynote-remarks",
                ceo: null,
                quote: "",
                note: "Something about the end of office jobs, said on stage last week. Worth a look?",
            },
            status: "open",
            createdAt: at("2026-10-31T21:10:00Z"),
        },
        {
            body: {
                url: "https://news.example/podcast-interview",
                ceo: "pichai",
                quote: "",
                note: "A podcast interview. I don't remember the exact words.",
            },
            status: "open",
            checks: {
                run: runSevenId,
                qualifies: false,
                finding: "The page reports an interview already on the record, with no new remark.",
            },
            createdAt: at("2026-10-29T17:45:00Z"),
        },
        {
            body: {
                url: "https://news.example/ram-remarks",
                ceo: "altman",
                quote: "",
                note: "The RAM one. It was everywhere.",
            },
            status: "done",
            note: "Already in the inbox.",
            createdAt: at("2026-10-31T12:00:00Z"),
            decidedAt: at("2026-10-31T18:20:00Z"),
        },
        {
            body: {
                url: "https://news.example/not-about-ai",
                ceo: null,
                quote: "",
                note: "Not AI, but still outrageous.",
            },
            status: "rejected",
            note: "Not an AI or tech statement.",
            createdAt: at("2026-10-12T08:05:00Z"),
            decidedAt: at("2026-10-12T19:40:00Z"),
        },
    ] as const;
    const researched = [];
    for (const s of suggestions) {
        const id = must(
            await seedRepo.addProposal({
                kind: "suggestion",
                status: s.status,
                origin: "visitor",
                body: s.body,
                checks: "checks" in s ? s.checks : null,
                note: "note" in s ? s.note : null,
                createdAt: s.createdAt,
                decidedAt: "decidedAt" in s ? s.decidedAt : null,
            }),
            "adding a suggestion"
        );
        if ("checks" in s) researched.push({id, url: s.body.url, ...s.checks, proposalId: null});
    }
    must(
        await seedRepo.setOutcomes(runSevenId, {
            proposed: runSevenProposed,
            missed: [
                {
                    kind: "failed",
                    ceo: "zuckerberg",
                    date: "2026-10-14",
                    venue: "Evening session interview",
                    statementId: "zuckerberg-2026-10-metaverse-never-the-point",
                    reason: failedReason,
                },
            ],
            suggestions: researched.map(({run: _run, ...rest}) => rest),
        }),
        "adding run 7's outcomes"
    );

    must(await seeder.addAdmin(DEV_ADMIN), "adding the dev admin");
    console.log(
        `Dev data: history on ${picks.length} statements, ${disputes.length} disputes, ${suggestions.length} suggestions, 4 scout proposals, 8 runs.`
    );
    console.log(`Dev admin: ${DEV_ADMIN.email}, password ${DEV_ADMIN.password}`);
} catch (error) {
    console.error(`Failed: ${(error as Error).message}`);
    process.exitCode = 1;
} finally {
    await dataService.teardown();
}
