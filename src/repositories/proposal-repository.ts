import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type {Proposal as ProposalModel, ProposalKind, ProposalStatus} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type {ProposalKind, ProposalStatus};

export type ProposalRecord = Omit<ProposalModel, "body" | "checks"> & {body: unknown; checks: unknown};

export type NewProposal = {
    kind: ProposalKind;
    origin: string;
    statementId?: MaybeNull<string>;
    body: unknown;
    checks?: unknown;
    runId?: MaybeNull<number>;
};

export type KindCounts = Partial<Record<ProposalKind, number>>;

export type ProposalFilter = {status?: ProposalStatus; kind?: ProposalKind};

function parsed(row: ProposalModel): ProposalRecord {
    return {...row, body: JSON.parse(row.body), checks: row.checks === null ? null : JSON.parse(row.checks)};
}

class ProposalRepository {
    constructor(private readonly db: DataService) {}

    create({kind, origin, statementId = null, body, checks, runId = null}: NewProposal): AsyncResult<number, DbError> {
        return this.db.run(
            "proposal-repo.create",
            this.db.p.proposal
                .create({
                    data: {
                        kind,
                        origin,
                        statementId,
                        body: JSON.stringify(body),
                        checks: checks == null ? null : JSON.stringify(checks),
                        runId,
                    },
                    select: {id: true},
                })
                .then((row) => row.id)
        );
    }

    list(where: ProposalFilter = {}, take?: number, skip?: number): AsyncResult<ProposalRecord[], DbError> {
        return this.db.run(
            "proposal-repo.list",
            this.db.p.proposal.findMany({where, orderBy: {id: "desc"}, take, skip}).then((rows) => rows.map(parsed))
        );
    }

    get(id: number): AsyncResult<MaybeNull<ProposalRecord>, DbError> {
        return this.db.run(
            "proposal-repo.get",
            this.db.p.proposal.findUnique({where: {id}}).then((row) => (row ? parsed(row) : null))
        );
    }

    // resolves to false when the proposal was already closed
    decide(
        id: number,
        status: Exclude<ProposalStatus, "open">,
        note: MaybeNull<string> = null
    ): AsyncResult<boolean, DbError> {
        return this.db.run(
            "proposal-repo.decide",
            this.db.p.proposal
                .updateMany({where: {id, status: "open"}, data: {status, note, decidedAt: new Date()}})
                .then((result) => result.count > 0)
        );
    }

    setChecks(id: number, checks: unknown): AsyncResult<void, DbError> {
        return this.db.run(
            "proposal-repo.setChecks",
            this.db.p.proposal.update({where: {id}, data: {checks: JSON.stringify(checks)}}).then(() => undefined)
        );
    }

    openFor(ceo: string): AsyncResult<number, DbError> {
        return this.db.run(
            "proposal-repo.openFor",
            Promise.all([
                this.db.p.statement.findMany({where: {ceo}, select: {id: true}}),
                this.db.p.proposal.findMany({
                    where: {status: "open", kind: {in: ["statement", "dispute"]}},
                    select: {kind: true, statementId: true, body: true},
                }),
            ]).then(([statements, open]) => {
                const ids = new Set(statements.map((s) => s.id));
                return open.filter((p) =>
                    p.kind === "dispute"
                        ? p.statementId !== null && ids.has(p.statementId)
                        : (JSON.parse(p.body) as {ceo?: unknown})?.ceo === ceo
                ).length;
            })
        );
    }

    openCounts(): AsyncResult<KindCounts, DbError> {
        return this.kindCounts({status: "open"});
    }

    kindCounts(where: Pick<ProposalFilter, "status"> = {}): AsyncResult<KindCounts, DbError> {
        return this.db.run(
            "proposal-repo.kindCounts",
            this.db.p.proposal
                .groupBy({by: ["kind"], where, _count: {_all: true}})
                .then((groups) => Object.fromEntries(groups.map((g) => [g.kind, g._count._all])))
        );
    }
}

export default ProposalRepository;
