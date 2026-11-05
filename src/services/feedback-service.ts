import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type ProposalRepository from "../repositories/proposal-repository.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const PER_ADDRESS_PER_HOUR = 10;
export const ALL_PER_DAY = 500;
const SWEEP_AT = 10_000;
const EVERYONE = "all";

export type Dispute = {statementId: string; category: string; direction: string; comment: string};

export type Suggestion = {url: string; ceo: MaybeNull<string>; quote: string; note: string};

class FixedWindow {
    readonly #hits = new Map<string, {start: number; count: number}>();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
        private readonly clock: () => number
    ) {}

    blocked(key: string): boolean {
        return (this.#current(key)?.count ?? 0) >= this.limit;
    }

    hit(key: string): number {
        let entry = this.#current(key);
        if (entry) entry.count += 1;
        else {
            entry = {start: this.clock(), count: 1};
            this.#hits.set(key, entry);
        }
        if (this.#hits.size > SWEEP_AT) {
            for (const [k, e] of this.#hits) if (this.clock() - e.start >= this.windowMs) this.#hits.delete(k);
        }
        return entry.start;
    }

    unhit(key: string, start: number): void {
        const entry = this.#current(key);
        if (entry && entry.start === start && entry.count > 0) entry.count -= 1;
    }

    #current(key: string) {
        const entry = this.#hits.get(key);
        return entry && this.clock() - entry.start < this.windowMs ? entry : null;
    }
}

export type Slot = {taken: boolean; release(): void};

class FeedbackService {
    readonly #perAddress: FixedWindow;
    readonly #everyone: FixedWindow;

    constructor(
        private readonly proposalRepo: ProposalRepository,
        clock: () => number = Date.now
    ) {
        this.#perAddress = new FixedWindow(PER_ADDRESS_PER_HOUR, HOUR_MS, clock);
        this.#everyone = new FixedWindow(ALL_PER_DAY, DAY_MS, clock);
    }

    // checks and counts in one tick, so parallel requests can't all pass the check before any is counted
    reserve(address: string): MaybeNull<Slot> {
        if (this.#perAddress.blocked(address) || this.#everyone.blocked(EVERYONE)) return null;
        const mine = this.#perAddress.hit(address);
        const all = this.#everyone.hit(EVERYONE);
        let released = false;
        const slot: Slot = {
            taken: false,
            release: () => {
                if (slot.taken || released) return;
                released = true;
                this.#perAddress.unhit(address, mine);
                this.#everyone.unhit(EVERYONE, all);
            },
        };
        return slot;
    }

    dispute(slot: Slot, {statementId, ...body}: Dispute): AsyncResult<number, DbError> {
        return this.#take(slot, {kind: "dispute", origin: "visitor", statementId, body});
    }

    suggest(slot: Slot, body: Suggestion): AsyncResult<number, DbError> {
        return this.#take(slot, {kind: "suggestion", origin: "visitor", body});
    }

    async #take(slot: Slot, proposal: Parameters<ProposalRepository["create"]>[0]): AsyncResult<number, DbError> {
        const created = await this.proposalRepo.create(proposal);
        if (created.ok) slot.taken = true;
        else slot.release();
        return created;
    }
}

export default FeedbackService;
