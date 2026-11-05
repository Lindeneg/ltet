import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError, type DbError} from "../lib/errors.js";
import type {RawStatement} from "../lib/content.js";
import type {MaybeNull} from "../lib/types.js";
import type ProposalRepository from "../repositories/proposal-repository.js";
import type {ProposalRecord, ProposalStatus} from "../repositories/proposal-repository.js";
import type StatementRepository from "../repositories/statement-repository.js";

export type InboxItem = ProposalRecord & {statement: MaybeNull<RawStatement>};

export type InboxStatus = "open" | "all";

export type CloseStatus = Extract<ProposalStatus, "rejected" | "done">;

class ProposalService {
    constructor(
        private readonly proposalRepo: ProposalRepository,
        private readonly statementRepo: StatementRepository
    ) {}

    async inbox(status: InboxStatus): AsyncResult<InboxItem[], DbError> {
        const proposals = await this.proposalRepo.list(status === "all" ? {} : {status: "open"});
        if (!proposals.ok) return proposals;
        const items: InboxItem[] = [];
        for (const proposal of proposals.data) {
            const statement = await this.#statementOf(proposal);
            if (!statement.ok) return statement;
            items.push({...proposal, statement: statement.data});
        }
        return success(items);
    }

    async openTotal(): AsyncResult<number, DbError> {
        const counts = await this.proposalRepo.openCounts();
        if (!counts.ok) return counts;
        return success(Object.values(counts.data).reduce((sum, n) => sum + (n ?? 0), 0));
    }

    async close(id: number, status: CloseStatus, note: MaybeNull<string>): AsyncResult<void, DbError> {
        const decided = await this.proposalRepo.decide(id, status, note);
        if (!decided.ok) return decided;
        return decided.data ? success(undefined) : failure(AppError.NOT_FOUND);
    }

    async #statementOf(proposal: ProposalRecord): AsyncResult<MaybeNull<RawStatement>, DbError> {
        if (proposal.kind === "statement" || !proposal.statementId) return success(null);
        const statement = await this.statementRepo.get(proposal.statementId);
        if (!statement.ok) return statement;
        return success(statement.data?.body ?? null);
    }
}

export default ProposalService;
