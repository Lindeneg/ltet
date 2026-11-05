import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import ProposalService from "../../../src/services/proposal-service.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {fake, makeProposal, makeStatement, makeStatementRecord} from "../helpers.js";

function setup() {
    const proposalRepo = {
        list: vi.fn().mockResolvedValue(success([])),
        openCounts: vi.fn().mockResolvedValue(success({statement: 2, dispute: 1})),
        decide: vi.fn().mockResolvedValue(success(true)),
    };
    const statementRepo = {get: vi.fn().mockResolvedValue(success({...makeStatementRecord(), history: []}))};
    const service = new ProposalService(
        fake<ProposalRepository>(proposalRepo),
        fake<StatementRepository>(statementRepo)
    );
    return {service, proposalRepo, statementRepo};
}

describe("ProposalService", () => {
    it("lists the open ones or all of them", async () => {
        const {service, proposalRepo} = setup();

        await service.inbox("open");
        await service.inbox("all");

        expect(proposalRepo.list).toHaveBeenNthCalledWith(1, {status: "open"});
        expect(proposalRepo.list).toHaveBeenNthCalledWith(2, {});
    });

    it("adds the statement a dispute is about, and none to a proposed statement", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.list.mockResolvedValue(
            success([makeProposal({id: 2, kind: "dispute", body: {}}), makeProposal({id: 1})])
        );

        const result = await service.inbox("open");

        if (!result.ok) throw new Error("expected success");
        expect(result.data[0].statement).toEqual(makeStatement());
        expect(result.data[1].statement).toBeNull();
        expect(statementRepo.get).toHaveBeenCalledOnce();
    });

    it("gives a dispute about a removed statement no statement", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.list.mockResolvedValue(success([makeProposal({kind: "dispute"})]));
        statementRepo.get.mockResolvedValue(success(null));

        const result = await service.inbox("open");

        expect(result.ok && result.data[0].statement).toBeNull();
    });

    it("adds up the open ones", async () => {
        expect(await setup().service.openTotal()).toEqual(success(3));
    });

    it("closes an open proposal and reports one that isn't", async () => {
        const {service, proposalRepo} = setup();

        expect(await service.close(1, "rejected", "why")).toEqual(success(undefined));
        expect(proposalRepo.decide).toHaveBeenCalledWith(1, "rejected", "why");

        proposalRepo.decide.mockResolvedValue(success(false));
        expect(await service.close(1, "done", null)).toEqual(failure(AppError.NOT_FOUND));
    });
});
