import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type {RunOutcomes} from "../lib/scout.js";
import type {ProposalStatus, Run as RunModel, RunStatus} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type {RunStatus};

export type RunRecord = Omit<RunModel, "summary" | "outcomes"> & {summary: unknown; outcomes: MaybeNull<RunOutcomes>};

export type RunListItem = Omit<RunRecord, "log" | "outcomes">;

export type RunFinish = {
    status: Exclude<RunStatus, "running">;
    summary: unknown;
    log: string;
    outcomes?: RunOutcomes;
};

export type RunClaim = {startedBy: MaybeNull<string>; dryRun: boolean; staleBefore: Date};

export type RunProposal = {id: number; statementId: MaybeNull<string>; status: ProposalStatus; newer: number};

const parseSummary = (summary: MaybeNull<string>) => (summary === null ? null : JSON.parse(summary));

const parseOutcomes = (outcomes: MaybeNull<string>): MaybeNull<RunOutcomes> =>
    outcomes === null ? null : (JSON.parse(outcomes) as RunOutcomes);

class RunRepository {
    constructor(private readonly db: DataService) {}

    // one statement so two starters can never both find the scout idle
    claim({startedBy, dryRun, staleBefore}: RunClaim): AsyncResult<MaybeNull<number>, DbError> {
        return this.db.run(
            "run-repo.claim",
            this.db.p.$queryRaw<Array<{id: number}>>`INSERT INTO "Run" ("status", "startedBy", "dryRun", "startedAt")
                SELECT 'running', ${startedBy}, ${dryRun}, ${new Date()}
                WHERE NOT EXISTS (SELECT 1 FROM "Run" WHERE "status" = 'running' AND "startedAt" > ${staleBefore})
                RETURNING "id"`.then((rows) => rows[0]?.id ?? null)
        );
    }

    running(staleBefore: Date): AsyncResult<MaybeNull<RunListItem>, DbError> {
        return this.db.run(
            "run-repo.running",
            this.db.p.run
                .findFirst({
                    where: {status: "running", startedAt: {gt: staleBefore}},
                    orderBy: {id: "desc"},
                    omit: {log: true, outcomes: true},
                })
                .then((row) => (row ? {...row, summary: parseSummary(row.summary)} : null))
        );
    }

    setPid(id: number, pid: number): AsyncResult<void, DbError> {
        return this.db.run(
            "run-repo.setPid",
            this.db.p.run.update({where: {id}, data: {pid}}).then(() => undefined)
        );
    }

    appendLog(id: number, line: string): AsyncResult<void, DbError> {
        return this.db.run(
            "run-repo.appendLog",
            this.db.p
                .$executeRaw`UPDATE "Run" SET "log" = COALESCE("log" || char(10), '') || ${line} WHERE "id" = ${id}`.then(
                () => undefined
            )
        );
    }

    // a run already finished keeps its status, so a late finish can't undo a stop
    finish(id: number, {status, summary, log, outcomes}: RunFinish): AsyncResult<void, DbError> {
        return this.db.run(
            "run-repo.finish",
            this.db.p.run
                .updateMany({
                    where: {id, status: "running"},
                    data: {
                        status,
                        summary: JSON.stringify(summary),
                        log,
                        outcomes: outcomes ? JSON.stringify(outcomes) : undefined,
                        finishedAt: new Date(),
                    },
                })
                .then(() => undefined)
        );
    }

    list(limit = 30, skip = 0): AsyncResult<RunListItem[], DbError> {
        return this.db.run(
            "run-repo.list",
            this.db.p.run
                .findMany({orderBy: {id: "desc"}, take: limit, skip, omit: {log: true, outcomes: true}})
                .then((rows) => rows.map((row) => ({...row, summary: parseSummary(row.summary)})))
        );
    }

    count(): AsyncResult<number, DbError> {
        return this.db.run("run-repo.count", this.db.p.run.count());
    }

    get(id: number): AsyncResult<MaybeNull<RunRecord>, DbError> {
        return this.db.run(
            "run-repo.get",
            this.db.p.run
                .findUnique({where: {id}})
                .then((row) =>
                    row ? {...row, summary: parseSummary(row.summary), outcomes: parseOutcomes(row.outcomes)} : null
                )
        );
    }

    proposals(id: number): AsyncResult<RunProposal[], DbError> {
        return this.db.run(
            "run-repo.proposals",
            this.db.p.proposal
                .findMany({
                    where: {runId: id},
                    orderBy: {id: "asc"},
                    select: {id: true, statementId: true, status: true},
                })
                .then(async (rows) => {
                    if (rows.length === 0) return [];
                    const later = await this.db.p.proposal.findMany({
                        where: {id: {gt: rows[0].id}},
                        orderBy: {id: "desc"},
                        select: {id: true},
                    });
                    return rows.map((row) => ({...row, newer: later.filter((p) => p.id > row.id).length}));
                })
        );
    }

    lastGoodStart(): AsyncResult<MaybeNull<Date>, DbError> {
        return this.db.run(
            "run-repo.lastGoodStart",
            this.db.p.run
                .findFirst({where: {status: "ok", dryRun: false}, orderBy: {id: "desc"}, select: {startedAt: true}})
                .then((row) => row?.startedAt ?? null)
        );
    }
}

export default RunRepository;
