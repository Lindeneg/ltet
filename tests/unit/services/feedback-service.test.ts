import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import FeedbackService, {ALL_PER_DAY, PER_ADDRESS_PER_HOUR} from "../../../src/services/feedback-service.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import {fake} from "../helpers.js";

const HOUR = 3_600_000;
const suggestion = {url: "https://one.example/a", ceo: null, quote: "", note: ""};

function setup(create = vi.fn().mockResolvedValue(success(1))) {
    let now = Date.UTC(2026, 0, 1);
    const service = new FeedbackService(fake<ProposalRepository>({create}), () => now);
    const take = async (address: string) => {
        const slot = service.reserve(address);
        if (!slot) return false;
        await service.suggest(slot, suggestion);
        return slot.taken;
    };
    return {service, create, take, advance: (ms: number) => (now += ms)};
}

describe("FeedbackService", () => {
    it("stores a dispute as a visitor's proposal on the statement", async () => {
        const {service, create} = setup();

        const slot = service.reserve("1.1.1.1")!;
        await service.dispute(slot, {statementId: "s1", category: "doom", direction: "more", comment: "Hm"});

        expect(slot.taken).toBe(true);
        expect(create).toHaveBeenCalledWith({
            kind: "dispute",
            origin: "visitor",
            statementId: "s1",
            body: {category: "doom", direction: "more", comment: "Hm"},
        });
    });

    it("stores a suggestion as a visitor's proposal", async () => {
        const {service, create} = setup();

        await service.suggest(service.reserve("1.1.1.1")!, suggestion);

        expect(create).toHaveBeenCalledWith({kind: "suggestion", origin: "visitor", body: suggestion});
    });

    it("limits an address to 10 an hour, then lets it send again", async () => {
        const {service, take, advance} = setup();

        for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++) expect(await take("1.1.1.1")).toBe(true);
        expect(service.reserve("1.1.1.1")).toBeNull();
        expect(service.reserve("2.2.2.2")).not.toBeNull();

        advance(HOUR);
        expect(service.reserve("1.1.1.1")).not.toBeNull();
    });

    it("limits everyone together to 500 a day", async () => {
        const {service, take, advance} = setup();

        for (let i = 0; i < ALL_PER_DAY; i++) await take(`10.0.${Math.floor(i / 250)}.${i % 250}`);

        expect(service.reserve("2.2.2.2")).toBeNull();
        advance(24 * HOUR);
        expect(service.reserve("2.2.2.2")).not.toBeNull();
    });

    it("holds a place from the check, so the 11th reservation in flight is refused", () => {
        const {service} = setup();

        const slots = Array.from({length: 11}, () => service.reserve("1.1.1.1"));

        expect(slots.filter(Boolean)).toHaveLength(10);
        expect(slots[10]).toBeNull();
    });

    it("gives the place back when the feedback is not taken, once only", () => {
        const {service} = setup();
        const slots = Array.from({length: 10}, () => service.reserve("1.1.1.1")!);

        slots[0].release();
        slots[0].release();

        expect(service.reserve("1.1.1.1")).not.toBeNull();
        expect(service.reserve("1.1.1.1")).toBeNull();
    });

    it("keeps the place of feedback that was taken", async () => {
        const {service} = setup();
        const slot = service.reserve("1.1.1.1")!;
        for (let i = 1; i < PER_ADDRESS_PER_HOUR; i++) service.reserve("1.1.1.1");

        await service.suggest(slot, suggestion);
        slot.release();

        expect(service.reserve("1.1.1.1")).toBeNull();
    });

    it("gives the place back when the save fails", async () => {
        const {service, take} = setup(vi.fn().mockResolvedValue(failure(AppError.DB_ERROR)));

        for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++) expect(await take("1.1.1.1")).toBe(false);

        expect(service.reserve("1.1.1.1")).not.toBeNull();
    });

    it("gives a late release to the window it was counted in, not to a new one", () => {
        const {service, advance} = setup();
        const old = service.reserve("1.1.1.1")!;

        advance(HOUR);
        const fresh = Array.from({length: 10}, () => service.reserve("1.1.1.1"));
        old.release();

        expect(fresh.filter(Boolean)).toHaveLength(10);
        expect(service.reserve("1.1.1.1")).toBeNull();
    });
});
