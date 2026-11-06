import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type {RawStatement} from "../lib/content.js";
import type {RunOutcomes} from "../lib/scout.js";
import type {ProposalKind, ProposalStatus, RunStatus} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type PastHistory = {
    statementId: string;
    body: RawStatement;
    published: boolean;
    note: string;
    changedAt: Date;
};

export type PastProposal = {
    kind: ProposalKind;
    status: ProposalStatus;
    origin: string;
    statementId?: MaybeNull<string>;
    body: unknown;
    checks?: unknown;
    runId?: MaybeNull<number>;
    note?: MaybeNull<string>;
    createdAt: Date;
    decidedAt?: MaybeNull<Date>;
};

export type PastRun = {
    status: RunStatus;
    summary: unknown;
    log: string;
    startedBy: string;
    dryRun?: boolean;
    startedAt: Date;
    finishedAt?: MaybeNull<Date>;
};

const json = (value: unknown) => (value == null ? null : JSON.stringify(value));

class SeedRepository {
    constructor(private readonly db: DataService) {}

    isEmpty(): AsyncResult<boolean, DbError> {
        const p = this.db.p;
        return this.db.run(
            "seed-repo.isEmpty",
            Promise.all([
                p.user.count(),
                p.statement.count(),
                p.statementHistory.count(),
                p.proposal.count(),
                p.run.count(),
                p.contender.count(),
                p.rubric.count(),
                p.category.count(),
            ]).then((counts) => counts.every((count) => count === 0))
        );
    }

    removeStatements(ids: string[]): AsyncResult<number, DbError> {
        return this.db.run(
            "seed-repo.removeStatements",
            this.db.p.statement.deleteMany({where: {id: {in: ids}}}).then((result) => result.count)
        );
    }

    setOrigin(id: string, origin: string, createdAt: Date): AsyncResult<void, DbError> {
        return this.db.run(
            "seed-repo.setOrigin",
            this.db.p.statement
                .update({where: {id}, data: {origin, createdAt, updatedAt: createdAt}})
                .then(() => undefined)
        );
    }

    addHistory({statementId, body, published, note, changedAt}: PastHistory): AsyncResult<void, DbError> {
        return this.db.run(
            "seed-repo.addHistory",
            this.db.p.statementHistory
                .create({data: {statementId, body: JSON.stringify(body), published, note, changedAt}})
                .then(() => undefined)
        );
    }

    addProposal(proposal: PastProposal): AsyncResult<number, DbError> {
        return this.db.run(
            "seed-repo.addProposal",
            this.db.p.proposal
                .create({
                    data: {
                        kind: proposal.kind,
                        status: proposal.status,
                        origin: proposal.origin,
                        statementId: proposal.statementId ?? null,
                        body: JSON.stringify(proposal.body),
                        checks: json(proposal.checks),
                        runId: proposal.runId ?? null,
                        note: proposal.note ?? null,
                        createdAt: proposal.createdAt,
                        decidedAt: proposal.decidedAt ?? null,
                    },
                    select: {id: true},
                })
                .then((row) => row.id)
        );
    }

    addRun({
        status,
        summary,
        log,
        startedBy,
        dryRun = false,
        startedAt,
        finishedAt = null,
    }: PastRun): AsyncResult<number, DbError> {
        return this.db.run(
            "seed-repo.addRun",
            this.db.p.run
                .create({
                    data: {status, summary: json(summary), log, startedBy, dryRun, startedAt, finishedAt},
                    select: {id: true},
                })
                .then((row) => row.id)
        );
    }

    setOutcomes(runId: number, outcomes: RunOutcomes): AsyncResult<void, DbError> {
        return this.db.run(
            "seed-repo.setOutcomes",
            this.db.p.run.update({where: {id: runId}, data: {outcomes: JSON.stringify(outcomes)}}).then(() => undefined)
        );
    }
}

export default SeedRepository;
