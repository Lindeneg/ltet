import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {success} from "../../../src/lib/result.js";
import {PROMPTS_DIR} from "../../../src/lib/paths.js";
import type {Page} from "../../../src/lib/quote-check.js";
import type {Lead} from "../../../src/lib/scout.js";
import ScoutService from "../../../src/services/scout-service.js";
import type ClaudeService from "../../../src/services/claude-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import type RunRepository from "../../../src/repositories/run-repository.js";
import {fake, makeContent, makeStatement} from "../helpers.js";

const NOW = Date.UTC(2026, 10, 1, 5);
const QUOTE = "every one of you will have a robot doing your dishes by spring";
const A = "https://one.example/a";
const B = "https://two.example/b";

const lead: Lead = {
    ceo: "altman",
    words: "robot doing your dishes",
    date: "2026-10-20",
    datePrecision: "day",
    venue: "A stage",
    leaked: false,
    quoteSource: A,
    sourceUrls: [A, B],
    headlineUrl: A,
    backlashUrl: B,
    backlashStrength: "outrage",
    why: "dishes",
    suggestion: 0,
};

const written = makeStatement({
    id: "Altman Dishes",
    date: "2026-10-20",
    quote: QUOTE,
    quoteSource: A,
    headline: {text: "Robots for dishes", outlet: "One", url: A},
    sources: [
        {outlet: "One", title: "t", url: A},
        {outlet: "Two", title: "t", url: B},
    ],
});

describe("ScoutService", () => {
    let runRepo: {
        running: Mock;
        claim: Mock;
        get: Mock;
        setPid: Mock;
        appendLog: Mock;
        finish: Mock;
        lastGoodStart: Mock;
    };
    let proposalRepo: {list: Mock; create: Mock; setChecks: Mock; decide: Mock};
    let claudeRun: Mock;
    let printed: string[];
    let errors: string[];

    async function scout() {
        return new ScoutService({
            statementRepo: fake<StatementRepository>({
                listAll: vi.fn().mockResolvedValue(success([{id: "x", body: makeStatement()}])),
            }),
            proposalRepo: fake<ProposalRepository>(proposalRepo),
            runRepo: fake<RunRepository>(runRepo),
            claude: fake<ClaudeService>({run: claudeRun}),
            content: makeContent(),
            model: "opus",
            workDir: join(await mkdtemp(join(tmpdir(), "ltet-scout-")), "scout-work"),
            promptsDir: PROMPTS_DIR,
            print: (line) => printed.push(line),
            printError: (line) => errors.push(line),
            fetchPage: async (url): Promise<Page> => ({
                ok: true,
                status: 200,
                text: url === A ? `<h1>Robots for dishes</h1><p>${QUOTE}</p>` : `<p>${QUOTE}</p>`,
            }),
            clock: () => NOW,
        });
    }

    beforeEach(() => {
        printed = [];
        errors = [];
        runRepo = {
            running: vi.fn().mockResolvedValue(success(null)),
            claim: vi.fn().mockResolvedValue(success(7)),
            get: vi.fn().mockResolvedValue(success({id: 9, status: "running"})),
            setPid: vi.fn().mockResolvedValue(success(undefined)),
            appendLog: vi.fn().mockResolvedValue(success(undefined)),
            finish: vi.fn().mockResolvedValue(success(undefined)),
            lastGoodStart: vi.fn().mockResolvedValue(success(new Date(Date.UTC(2026, 9, 30)))),
        };
        proposalRepo = {
            list: vi.fn().mockResolvedValue(success([])),
            create: vi.fn().mockResolvedValue(success(42)),
            setChecks: vi.fn().mockResolvedValue(success(undefined)),
            decide: vi.fn().mockResolvedValue(success(true)),
        };
        claudeRun = vi
            .fn()
            .mockResolvedValueOnce({
                output: {leads: [lead], suggestionOutcomes: [], searched: "news"},
                costUsd: 0.2,
                turns: 3,
            })
            .mockResolvedValueOnce({
                output: {results: [{lead: 0, keep: true, dropReason: "", statement: written}]},
                costUsd: 0.111,
                turns: 1,
            });
    });

    it("proposes a verified statement and finishes the run", async () => {
        expect(await (await scout()).run({dryRun: false})).toBe(true);

        expect(proposalRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({kind: "statement", origin: "scout", statementId: "altman-dishes", runId: 7})
        );
        expect(printed[0]).toBe("Scout run 7: statements since 2026-10-27, model opus.");
        expect(printed).toContain("Proposed: altman-dishes, 5 pitchforks, quote on 2 site(s).");
        const [id, finish] = runRepo.finish.mock.calls[0];
        expect(id).toBe(7);
        expect(finish.status).toBe("ok");
        expect(finish.summary).toMatchObject({since: "2026-10-27", proposed: 1, verified: 1, costUsd: 0.31});
        expect(finish.log).toBe(printed.join("\n"));
    });

    it("looks back 14 days at most and takes --since over that", async () => {
        runRepo.lastGoodStart.mockResolvedValue(success(null));
        await (await scout()).run({dryRun: false});
        expect(printed[0]).toContain("since 2026-10-18");

        printed = [];
        claudeRun.mockResolvedValue({output: {leads: [], suggestionOutcomes: [], searched: ""}, costUsd: 0, turns: 0});
        await (await scout()).run({dryRun: false, since: "2026-01-01"});
        expect(printed[0]).toContain("since 2026-01-01");
    });

    it("writes nothing on a dry run and prints the statement", async () => {
        expect(await (await scout()).run({dryRun: true})).toBe(true);

        expect(runRepo.claim).not.toHaveBeenCalled();
        expect(runRepo.appendLog).not.toHaveBeenCalled();
        expect(runRepo.finish).not.toHaveBeenCalled();
        expect(proposalRepo.create).not.toHaveBeenCalled();
        expect(printed[0]).toContain("Scout run (dry)");
        expect(JSON.parse(printed.find((line) => line.startsWith("{"))!)).toMatchObject({id: "altman-dishes"});
    });

    it("refuses to start while another run is going", async () => {
        runRepo.claim.mockResolvedValue(success(null));
        runRepo.running.mockResolvedValue(success({id: 3, status: "running", startedAt: new Date(NOW - 3_600_000)}));

        expect(await (await scout()).run({dryRun: false})).toBe(false);

        expect(errors).toEqual(["Run 3 is still going (started 2026-11-01T04:00:00.000Z); not starting another."]);
        expect(runRepo.finish).not.toHaveBeenCalled();
    });

    it("refuses a dry run by hand while another run is going, and takes no lock for it", async () => {
        runRepo.running.mockResolvedValue(success({id: 3, status: "running", startedAt: new Date(NOW - 3_600_000)}));

        expect(await (await scout()).run({dryRun: true})).toBe(false);

        expect(errors).toEqual(["Run 3 is still going (started 2026-11-01T04:00:00.000Z); not starting another."]);
        expect(runRepo.claim).not.toHaveBeenCalled();
    });

    it("claims the run by hand, taking one running for over three hours to have died", async () => {
        expect(await (await scout()).run({dryRun: false})).toBe(true);

        expect(runRepo.claim).toHaveBeenCalledWith({
            startedBy: null,
            dryRun: false,
            staleBefore: new Date(NOW - 3 * 3_600_000),
        });
        expect(runRepo.setPid).toHaveBeenCalledWith(7, process.pid);
    });

    it("writes each log line to the run as it goes", async () => {
        await (await scout()).run({dryRun: false});

        expect(runRepo.appendLog.mock.calls.map(([id, line]) => [id, line])).toEqual(printed.map((line) => [7, line]));
        expect(runRepo.appendLog.mock.invocationCallOrder.at(-1)).toBeLessThan(
            runRepo.finish.mock.invocationCallOrder[0]
        );
    });

    it("runs the run the server claimed, and saves a dry one with its statements in the log", async () => {
        expect(await (await scout()).run({dryRun: true, runId: 9})).toBe(true);

        expect(runRepo.get).toHaveBeenCalledWith(9);
        expect(runRepo.claim).not.toHaveBeenCalled();
        expect(proposalRepo.create).not.toHaveBeenCalled();
        const [id, finish] = runRepo.finish.mock.calls[0];
        expect(id).toBe(9);
        expect(finish.status).toBe("ok");
        expect(finish.log).toContain(`"id": "altman-dishes"`);
    });

    it("leaves a claimed run alone when it is no longer running", async () => {
        runRepo.get.mockResolvedValue(success({id: 9, status: "stopped"}));

        expect(await (await scout()).run({dryRun: false, runId: 9})).toBe(false);

        expect(errors).toEqual(["Run 9 is not waiting to start; not starting it."]);
        expect(claudeRun).not.toHaveBeenCalled();
        expect(runRepo.finish).not.toHaveBeenCalled();
    });

    it("finishes as stopped when it is stopped, passing the signal to claude", async () => {
        const stop = new AbortController();
        claudeRun.mockReset().mockImplementation(async ({signal}: {signal: AbortSignal}) => {
            stop.abort();
            expect(signal.aborted).toBe(true);
            throw new Error("stopped");
        });

        expect(await (await scout()).run({dryRun: false, runId: 9, signal: stop.signal})).toBe(false);

        expect(printed.at(-1)).toBe("Stopped.");
        expect(runRepo.finish.mock.calls[0][1].status).toBe("stopped");
    });

    it("finishes the run as failed when claude fails", async () => {
        claudeRun.mockReset().mockRejectedValue(new Error("claude ran past 45 minutes"));

        expect(await (await scout()).run({dryRun: false})).toBe(false);

        expect(printed.at(-1)).toBe("Failed: claude ran past 45 minutes");
        expect(runRepo.finish.mock.calls[0][1].status).toBe("failed");
    });

    it("records what it found for a visitor's suggestion and closes the one it researched", async () => {
        const suggestion = {
            id: 5,
            kind: "suggestion",
            status: "open",
            checks: null,
            body: {url: A, ceo: null, quote: "", note: ""},
        };
        proposalRepo.list.mockImplementation(async ({kind}: {kind: string}) =>
            success(kind === "suggestion" ? [suggestion] : [])
        );
        claudeRun
            .mockReset()
            .mockResolvedValueOnce({
                output: {
                    leads: [{...lead, suggestion: 5}],
                    suggestionOutcomes: [{id: 5, qualifies: true, finding: "real"}],
                    searched: "",
                },
                costUsd: 0,
                turns: 1,
            })
            .mockResolvedValueOnce({
                output: {results: [{lead: 0, keep: true, dropReason: "", statement: written}]},
                costUsd: 0,
                turns: 1,
            });

        await (await scout()).run({dryRun: false});

        expect(claudeRun.mock.calls[0][0].prompt).toContain(`- Suggestion 5: ${A}`);
        expect(proposalRepo.setChecks).toHaveBeenCalledWith(5, {run: 7, qualifies: true, finding: "real"});
        expect(proposalRepo.create).toHaveBeenCalledWith(expect.objectContaining({origin: "visitor"}));
        expect(proposalRepo.decide).toHaveBeenCalledWith(5, "done", "Researched by run 7: proposal 42.");
    });

    it.each([
        ["a dispute's id", 9],
        ["a suggestion already checked", 6],
        ["an id that doesn't exist", 404],
    ])("takes a lead naming %s as the scout's own and closes nothing", async (_, id) => {
        const checked = {id: 6, kind: "suggestion", status: "open", checks: {run: 1}, body: {url: B}};
        proposalRepo.list.mockImplementation(async ({kind}: {kind: string}) =>
            success(kind === "suggestion" ? [checked] : [])
        );
        claudeRun
            .mockReset()
            .mockResolvedValueOnce({
                output: {leads: [{...lead, suggestion: id}], suggestionOutcomes: [], searched: ""},
                costUsd: 0,
                turns: 1,
            })
            .mockResolvedValueOnce({
                output: {results: [{lead: 0, keep: true, dropReason: "", statement: written}]},
                costUsd: 0,
                turns: 1,
            });

        await (await scout()).run({dryRun: false});

        expect(printed).toContain(
            `Ignored suggestion ${id} on the lead altman, 2026-10-20: not one of this run's open suggestions.`
        );
        expect(proposalRepo.create).toHaveBeenCalledWith(expect.objectContaining({origin: "scout"}));
        expect(proposalRepo.decide).not.toHaveBeenCalled();
    });

    it("drops a duplicate of the record", async () => {
        claudeRun
            .mockReset()
            .mockResolvedValueOnce({
                output: {leads: [lead], suggestionOutcomes: [], searched: ""},
                costUsd: 0,
                turns: 1,
            })
            .mockResolvedValueOnce({
                output: {
                    results: [
                        {
                            lead: 0,
                            keep: true,
                            dropReason: "",
                            statement: makeStatement({id: "again", date: "2026-10-20"}),
                        },
                    ],
                },
                costUsd: 0,
                turns: 1,
            });

        await (await scout()).run({dryRun: false});

        expect(printed).toContain("Duplicate: again repeats altman-2025-09-01-statement.");
        expect(proposalRepo.create).not.toHaveBeenCalled();
    });
});
