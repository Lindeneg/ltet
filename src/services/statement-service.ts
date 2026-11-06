import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError} from "../lib/errors.js";
import type {RawStatement} from "../lib/content.js";
import {statementErrors} from "../lib/statement-rules.js";
import type {MaybeNull, ValueOf} from "../lib/types.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type ProposalRepository from "../repositories/proposal-repository.js";
import type {ProposalRecord} from "../repositories/proposal-repository.js";
import type ContentService from "./content-service.js";

export const WriteError = {
    ...AppError,
    ID_CHANGED: "id_changed",
    NOT_OPEN: "not_open",
    NOT_A_STATEMENT: "not_a_statement",
} as const;

export type WriteError = ValueOf<typeof WriteError>;

export type WriteFailure = {code: WriteError; errors: string[]};

const existsAlready = (id: string) => `a statement with the id ${id} exists already`;

const fail = (code: WriteError, errors: string[] = []) => failure<WriteFailure>({code, errors});

class StatementService {
    constructor(
        private readonly statementRepo: StatementRepository,
        private readonly proposalRepo: ProposalRepository,
        private readonly content: ContentService,
        private readonly onChange: () => void
    ) {}

    async save(id: string, statement: unknown, note: string): AsyncResult<void, WriteFailure> {
        const current = await this.statementRepo.get(id);
        if (!current.ok) return fail(current.ctx);
        if (!current.data) return fail(WriteError.NOT_FOUND);
        if ((statement as Partial<RawStatement>)?.id !== id) return fail(WriteError.ID_CHANGED);

        const errors = statementErrors(statement, this.content.get());
        if (errors.length > 0) return fail(WriteError.INVALID, errors);

        const saved = await this.statementRepo.save(statement as RawStatement, {
            origin: current.data.origin,
            published: current.data.published,
            note,
        });
        if (!saved.ok) return fail(saved.ctx);
        this.onChange();
        return success(undefined);
    }

    async setPublished(id: string, published: boolean, note: MaybeNull<string>): AsyncResult<void, WriteFailure> {
        const result = await this.statementRepo.setPublished(id, published, note);
        if (!result.ok) return fail(result.ctx);
        if (!result.data) return fail(WriteError.NOT_FOUND);
        this.onChange();
        return success(undefined);
    }

    async approvable(proposalId: number): AsyncResult<ProposalRecord, WriteFailure> {
        const proposal = await this.proposalRepo.get(proposalId);
        if (!proposal.ok) return fail(proposal.ctx);
        if (!proposal.data || proposal.data.status !== "open") return fail(WriteError.NOT_OPEN);
        if (proposal.data.kind !== "statement") return fail(WriteError.NOT_A_STATEMENT);
        return success(proposal.data);
    }

    async approve(proposalId: number, statement: unknown): AsyncResult<string, WriteFailure> {
        const proposal = await this.approvable(proposalId);
        if (!proposal.ok) return proposal;

        const errors = statementErrors(statement, this.content.get());
        const id = String((statement as Partial<RawStatement>)?.id);
        const exists = await this.statementRepo.has(id);
        if (!exists.ok) return fail(exists.ctx);
        if (exists.data) errors.push(existsAlready(id));
        if (errors.length > 0) return fail(WriteError.INVALID, errors);

        const approved = await this.statementRepo.approve(
            proposal.data.id,
            statement as RawStatement,
            proposal.data.origin
        );
        if (!approved.ok) {
            return approved.ctx === AppError.CONFLICT
                ? fail(WriteError.INVALID, [existsAlready(id)])
                : fail(approved.ctx);
        }
        if (!approved.data) return fail(WriteError.NOT_OPEN);
        this.onChange();
        return success(id);
    }
}

export default StatementService;
