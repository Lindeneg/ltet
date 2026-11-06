import {mkdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import type {Content, RawStatement} from "../lib/content.js";
import type {Result} from "../lib/result.js";
import {statementErrors, workingNoteErrors} from "../lib/statement-rules.js";
import {tally} from "../lib/score.js";
import {excerpt, pageCache, pageText, pageTitles, type PageLoader} from "../lib/pages.js";
import {
    RECORD_START_DAY,
    VERIFIED_PAGES,
    day,
    daysBefore,
    example,
    fill,
    findSchema,
    formatCost,
    nearest,
    rubricLines,
    sameStatement,
    spread,
    uniqueId,
    verify,
    writeSchema,
    type FindOutput,
    type RunOutcomes,
    type WriteOutput,
} from "../lib/scout.js";
import type {MaybeNull} from "../lib/types.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type ProposalRepository from "../repositories/proposal-repository.js";
import type {ProposalRecord} from "../repositories/proposal-repository.js";
import type RunRepository from "../repositories/run-repository.js";
import type ClaudeService from "./claude-service.js";

const FIRST_LOOKBACK_DAYS = 14;
const OVERLAP_DAYS = 3;
const FIND_TIMEOUT_MS = 45 * 60_000;
const WRITE_TIMEOUT_MS = 20 * 60_000;
export const STALE_RUN_MS = 3 * 3_600_000;

export type ScoutOpts = {since?: string; dryRun: boolean; runId?: number; signal?: AbortSignal};

export type ScoutDeps = {
    statementRepo: StatementRepository;
    proposalRepo: ProposalRepository;
    runRepo: RunRepository;
    claude: ClaudeService;
    content: Content;
    model: string;
    workDir: string;
    promptsDir: string;
    print: (line: string) => void;
    printError: (line: string) => void;
    fetchPage?: PageLoader;
    clock?: () => number;
};

export type ScoutSummary = {
    since: string;
    model: string;
    leads: number;
    written: number;
    proposed: number;
    verified: number;
    onePage: number;
    dropped: number;
    duplicates: number;
    failed: number;
    suggestions: number;
    costUsd: number;
};

type Suggestion = {url: string; ceo: MaybeNull<string>; quote: string; note: string};

type Run = {
    id: MaybeNull<number>;
    dryRun: boolean;
    today: string;
    since: string;
    summary: ScoutSummary;
    outcomes: RunOutcomes;
    log: string[];
    signal?: AbortSignal;
};

const missed = (lead: {ceo: string; date: string; venue: string}) => ({
    ceo: lead.ceo,
    date: lead.date,
    venue: lead.venue,
    statementId: null,
});

function must<T>(result: Result<T, string>, label: string): T {
    if (!result.ok) throw new Error(`${label}: ${result.ctx}`);
    return result.data;
}

class ScoutService {
    constructor(private readonly deps: ScoutDeps) {}

    async run({since: sinceOpt, dryRun, runId, signal}: ScoutOpts): Promise<boolean> {
        const {runRepo, print, printError, model, workDir} = this.deps;
        const now = this.deps.clock?.() ?? Date.now();
        const staleBefore = new Date(now - STALE_RUN_MS);

        let id: MaybeNull<number> = null;
        if (runId !== undefined) {
            const claimed = must(await runRepo.get(runId), "finding the run");
            if (claimed?.status !== "running") {
                printError(`Run ${runId} is not waiting to start; not starting it.`);
                return false;
            }
            id = runId;
        } else {
            const busy = async () => {
                const running = must(await runRepo.running(staleBefore), "listing runs");
                if (running) {
                    printError(
                        `Run ${running.id} is still going (started ${running.startedAt.toISOString()}); not starting another.`
                    );
                }
                return running !== null;
            };
            if (dryRun) {
                if (await busy()) return false;
            } else {
                id = must(await runRepo.claim({startedBy: null, dryRun, staleBefore}), "starting the run");
                if (id === null) {
                    await busy();
                    return false;
                }
                must(await runRepo.setPid(id, process.pid), "saving the pid");
            }
        }
        await mkdir(workDir, {recursive: true});

        const today = day(new Date(now));
        const lastGood = must(await runRepo.lastGoodStart(), "finding the last good run");
        const since =
            sinceOpt ??
            [lastGood ? daysBefore(lastGood.toISOString(), OVERLAP_DAYS) : null, daysBefore(today, FIRST_LOOKBACK_DAYS)]
                .filter((d): d is string => d !== null)
                .sort()
                .at(-1)!;
        const summary: ScoutSummary = {
            since,
            model,
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
        };
        const outcomes: RunOutcomes = {proposed: [], missed: [], suggestions: []};
        const run: Run = {id, dryRun, today, since, summary, outcomes, log: [], signal};
        let saved = Promise.resolve();
        const log = (line: string) => {
            run.log.push(line);
            print(line);
            if (id !== null) {
                const runId = id;
                saved = saved.then(async () => {
                    await runRepo.appendLog(runId, line);
                });
            }
        };

        try {
            await this.#scout(run, log);
            summary.costUsd = Math.round(summary.costUsd * 100) / 100;
            log(
                `Done: ${summary.proposed} proposed (${summary.verified} verified on ${VERIFIED_PAGES}+ sites, ${summary.onePage} on one), ${summary.dropped} dropped, ${summary.duplicates} duplicates, ${summary.failed} failed checks. Cost estimate ${formatCost(summary.costUsd)} (subscription usage, not a bill).`
            );
            await saved;
            if (id !== null)
                must(await runRepo.finish(id, {status: "ok", summary, outcomes, log: run.log.join("\n")}), "finishing");
            return true;
        } catch (error) {
            const stopped = signal?.aborted === true;
            log(stopped ? "Stopped." : `Failed: ${(error as Error).message}`);
            await saved;
            if (id !== null)
                await runRepo.finish(id, {
                    status: stopped ? "stopped" : "failed",
                    summary,
                    outcomes,
                    log: run.log.join("\n"),
                });
            return false;
        }
    }

    async #template(name: string): Promise<string> {
        return readFile(join(this.deps.promptsDir, name), "utf8");
    }

    async #scout(run: Run, log: (line: string) => void): Promise<void> {
        const {statementRepo, proposalRepo, claude, content, model, workDir} = this.deps;
        const {ceos, rubric} = content;
        const {summary, outcomes, today, since, dryRun} = run;

        const halt = () => {
            if (run.signal?.aborted) throw new Error("stopped");
        };
        halt();
        log(`Scout run ${run.id ?? "(dry)"}: statements since ${since}, model ${model}.`);
        const statements = must(await statementRepo.listAll(), "listing statements").map((row) => row.body);
        const proposed = must(await proposalRepo.list({kind: "statement"}), "listing proposals");
        const proposedBody = (p: ProposalRecord) => p.body as RawStatement;
        const suggestions = must(
            await proposalRepo.list({status: "open", kind: "suggestion"}),
            "listing suggestions"
        ).filter((p) => !p.checks);

        const known = [
            ...statements.map((s) => `- ${s.ceo}, ${s.date}, ${s.venue}: "${s.quote.slice(0, 90)}"`),
            ...proposed.map((p) => {
                const b = proposedBody(p);
                const rejected = p.status === "rejected" ? ` (rejected${p.note ? `: ${p.note}` : ""})` : "";
                return `- ${b.ceo}, ${b.date}, ${b.venue}: "${b.quote.slice(0, 90)}"${rejected}`;
            }),
        ].join("\n");
        const describeSuggestion = (p: ProposalRecord) => {
            const b = p.body as Suggestion;
            return `- Suggestion ${p.id}: ${b.url}${b.ceo ? `, about ${b.ceo}` : ""}${b.quote ? `, words: "${b.quote}"` : ""}${b.note ? `, note: ${b.note}` : ""}`;
        };
        const find = await claude.run<FindOutput>({
            prompt: fill(await this.#template("find.md"), {
                today,
                since,
                ceos: ceos.map((c) => `- ${c.name} (${c.company}), id "${c.id}"`).join("\n"),
                suggestions: suggestions.length === 0 ? "None today." : suggestions.map(describeSuggestion).join("\n"),
                known,
            }),
            schema: findSchema(ceos),
            tools: ["WebSearch", "WebFetch"],
            model,
            timeoutMs: FIND_TIMEOUT_MS,
            cwd: workDir,
            signal: run.signal,
        });
        summary.costUsd += find.costUsd;
        const leads = find.output.leads.filter((lead) => ceos.some((c) => c.id === lead.ceo));
        summary.leads = leads.length;
        log(`Find: ${leads.length} leads in ${find.turns} turns. Searched: ${find.output.searched}`);
        for (const lead of leads) {
            if (lead.suggestion && !suggestions.some((p) => p.id === lead.suggestion)) {
                log(
                    `Ignored suggestion ${lead.suggestion} on the lead ${lead.ceo}, ${lead.date}: not one of this run's open suggestions.`
                );
                lead.suggestion = 0;
            }
        }

        for (const outcome of find.output.suggestionOutcomes) {
            const suggestion = suggestions.find((p) => p.id === outcome.id);
            if (!suggestion || dryRun) continue;
            must(
                await proposalRepo.setChecks(suggestion.id, {
                    run: run.id,
                    qualifies: outcome.qualifies,
                    finding: outcome.finding,
                }),
                "saving a suggestion's checks"
            );
            summary.suggestions += 1;
            outcomes.suggestions.push({
                id: suggestion.id,
                url: (suggestion.body as Suggestion).url,
                qualifies: outcome.qualifies,
                finding: outcome.finding,
                proposalId: null,
            });
        }
        if (leads.length === 0) return;

        const load = pageCache(this.deps.fetchPage);
        const leadPages = await Promise.all(
            leads.map(async (lead) => {
                const urls = [...new Set([lead.quoteSource, ...lead.sourceUrls, lead.headlineUrl, lead.backlashUrl])];
                const pages = await Promise.all(
                    urls.map(async (url) => {
                        const page = await load(url);
                        if (!page.ok) return {url, loaded: false as const, status: page.status};
                        const text = pageText(page.text);
                        const hint =
                            url === lead.backlashUrl && url !== lead.quoteSource
                                ? `${lead.words} backlash criticism`
                                : lead.words;
                        return {url, loaded: true as const, titles: pageTitles(page.text), text: excerpt(text, hint)};
                    })
                );
                return {lead, pages};
            })
        );

        halt();
        const scored = tally(ceos, rubric, statements).statements;
        const write = await claude.run<WriteOutput>({
            prompt: fill(await this.#template("extract.md"), {
                today,
                topics: [...new Set(statements.flatMap((s) => s.topics ?? []))].join(", "),
                rubric: rubric.categories.map(rubricLines).join("\n"),
                examples: spread(scored).map(example).join("\n"),
                leads: leadPages
                    .map(({lead, pages}, i) =>
                        [
                            `### Lead ${i}: ${lead.ceo}, ${lead.date} (${lead.datePrecision}), ${lead.venue}${lead.leaked ? ", leaked" : ""}`,
                            `The scout saw these words: "${lead.words}"`,
                            `The record's statements most like it, as they were scored:\n${nearest(
                                scored,
                                `${lead.words} ${lead.venue} ${lead.why}`
                            )
                                .map(example)
                                .join("\n")}`,
                            `quoteSource: ${lead.quoteSource}; headline page: ${lead.headlineUrl}; backlash page: ${lead.backlashUrl} (${lead.backlashStrength}); why: ${lead.why}`,
                            ...pages.map((p) =>
                                p.loaded
                                    ? `#### ${p.url}\nTitles: ${p.titles.map((t) => `"${t}"`).join(" / ")}\nText: ${p.text}`
                                    : `#### ${p.url}\n(did not load: ${p.status})`
                            ),
                        ].join("\n\n")
                    )
                    .join("\n\n"),
            }),
            schema: writeSchema(ceos, rubric),
            model,
            timeoutMs: WRITE_TIMEOUT_MS,
            cwd: workDir,
            signal: run.signal,
        });
        summary.costUsd += write.costUsd;

        const takenIds = new Set([...statements.map((s) => s.id), ...proposed.map((p) => proposedBody(p).id)]);
        const others = [...statements, ...proposed.map(proposedBody)];
        for (const result of write.output.results) {
            halt();
            const lead = leads[result.lead];
            if (!lead) continue;
            if (!result.keep || !result.statement) {
                summary.dropped += 1;
                outcomes.missed.push({...missed(lead), kind: "dropped", reason: result.dropReason});
                log(`Dropped: ${lead.ceo}, ${lead.date}, ${lead.venue}: ${result.dropReason}`);
                continue;
            }
            summary.written += 1;
            const statement: RawStatement = {...result.statement, ceo: lead.ceo};
            statement.id = uniqueId(statement.id, takenIds);

            const twin = others.find((other) => sameStatement(statement, other));
            if (twin) {
                summary.duplicates += 1;
                outcomes.missed.push({
                    ...missed(lead),
                    kind: "duplicate",
                    statementId: statement.id,
                    reason: `repeats ${twin.id}`,
                });
                log(`Duplicate: ${statement.id} repeats ${twin.id}.`);
                continue;
            }
            const errors = [...statementErrors(statement, {ceos, rubric}), ...workingNoteErrors(statement)];
            if (statement.date < RECORD_START_DAY) errors.push(`dated ${statement.date}, before the record starts`);
            const checks = await verify(statement, load);
            if (checks.foundOn === 0) errors.push("the quote was not found word for word on any page that loaded");
            if (errors.length > 0) {
                summary.failed += 1;
                outcomes.missed.push({
                    ...missed(lead),
                    kind: "failed",
                    statementId: statement.id,
                    reason: errors.join("; "),
                });
                log(`Failed checks: ${statement.id}: ${errors.join("; ")}`);
                continue;
            }

            takenIds.add(statement.id);
            others.push(statement);
            if (checks.verified) summary.verified += 1;
            else summary.onePage += 1;
            summary.proposed += 1;
            const forks = tally(ceos, rubric, [statement]).statements[0].forks;
            log(
                `Proposed: ${statement.id}, ${forks} ${rubric.unit.many}, quote on ${checks.foundOn} site(s)${checks.headlineFound ? "" : ", headline not found on its page"}.`
            );
            const entry = {
                statementId: statement.id,
                ceo: statement.ceo,
                headline: statement.headline.text,
                verified: checks.verified,
                foundOn: checks.foundOn,
                forks,
                proposalId: null as MaybeNull<number>,
            };
            outcomes.proposed.push(entry);
            if (dryRun) {
                log(JSON.stringify(statement, null, 2));
                continue;
            }
            const proposalId = must(
                await proposalRepo.create({
                    kind: "statement",
                    origin: lead.suggestion ? "visitor" : "scout",
                    statementId: statement.id,
                    body: statement,
                    checks,
                    runId: run.id,
                }),
                "saving a proposal"
            );
            entry.proposalId = proposalId;
            if (lead.suggestion) {
                const researched = outcomes.suggestions.find((s) => s.id === lead.suggestion);
                if (researched) researched.proposalId = proposalId;
                must(
                    await proposalRepo.decide(
                        lead.suggestion,
                        "done",
                        `Researched by run ${run.id}: proposal ${proposalId}.`
                    ),
                    "closing a suggestion"
                );
            }
        }
    }
}

export default ScoutService;
