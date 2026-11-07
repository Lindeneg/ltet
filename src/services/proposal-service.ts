import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError, type DbError} from "../lib/errors.js";
import type {RawStatement} from "../lib/content.js";
import type {MaybeNull} from "../lib/types.js";
import type ProposalRepository from "../repositories/proposal-repository.js";
import type {KindCounts, ProposalKind, ProposalRecord, ProposalStatus} from "../repositories/proposal-repository.js";
import type StatementRepository from "../repositories/statement-repository.js";

export type InboxItem = ProposalRecord & {statement: MaybeNull<RawStatement>};

export type InboxStatus = "open" | "all";

export type InboxFilter = {status: InboxStatus; kind: MaybeNull<ProposalKind>};

export type InboxPage = {items: InboxItem[]; counts: KindCounts; page: number; pages: number};

export const INBOX_PAGE = 50;

export type CloseStatus = Extract<ProposalStatus, "rejected" | "done">;

class ProposalService {
    constructor(
        private readonly proposalRepo: ProposalRepository,
        private readonly statementRepo: StatementRepository
    ) {}

    async inbox(filter: InboxFilter, page: number, clamp = false): AsyncResult<InboxPage, DbError> {
        const counted = await this.#count(filter);
        if (!counted.ok) return counted;
        const {counts, pages} = counted.data;
        if (page > pages && !clamp) return failure(AppError.NOT_FOUND);
        const current = Math.min(page, pages);
        const where = {
            ...(filter.status === "open" && {status: "open" as const}),
            ...(filter.kind && {kind: filter.kind}),
        };
        const proposals = await this.proposalRepo.list(where, INBOX_PAGE, (current - 1) * INBOX_PAGE);
        if (!proposals.ok) return proposals;
        const ids = [
            ...new Set(proposals.data.flatMap((p) => (p.kind === "dispute" && p.statementId ? [p.statementId] : []))),
        ];
        const bodies = ids.length ? await this.statementRepo.bodies(ids) : success(new Map<string, RawStatement>());
        if (!bodies.ok) return bodies;
        const items = proposals.data.map((p) => ({
            ...p,
            statement: p.kind === "dispute" && p.statementId ? (bodies.data.get(p.statementId) ?? null) : null,
        }));
        return success({items, counts, page: current, pages});
    }

    async lastPage(filter: InboxFilter): AsyncResult<number, DbError> {
        const counted = await this.#count(filter);
        return counted.ok ? success(counted.data.pages) : counted;
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

    async #count(filter: InboxFilter): AsyncResult<{counts: KindCounts; pages: number}, DbError> {
        const counts = await this.proposalRepo.kindCounts(filter.status === "open" ? {status: "open"} : {});
        if (!counts.ok) return counts;
        const total = filter.kind
            ? (counts.data[filter.kind] ?? 0)
            : Object.values(counts.data).reduce((sum, n) => sum + (n ?? 0), 0);
        return success({counts: counts.data, pages: Math.max(1, Math.ceil(total / INBOX_PAGE))});
    }
}

export default ProposalService;
