import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import ProposalService from "../../../src/services/proposal-service.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {fake, makeProposal, makeStatement} from "../helpers.js";

function setup() {
    const proposalRepo = {
        list: vi.fn().mockResolvedValue(success([])),
        kindCounts: vi.fn().mockResolvedValue(success({})),
        openCounts: vi.fn().mockResolvedValue(success({statement: 2, dispute: 1})),
        decide: vi.fn().mockResolvedValue(success(true)),
    };
    const statementRepo = {bodies: vi.fn().mockResolvedValue(success(new Map([["a-statement", makeStatement()]])))};
    const service = new ProposalService(
        fake<ProposalRepository>(proposalRepo),
        fake<StatementRepository>(statementRepo)
    );
    return {service, proposalRepo, statementRepo};
}

const open = {status: "open", kind: null} as const;

describe("ProposalService", () => {
    it("lists the open ones or all of them, newest first, 50 a page", async () => {
        const {service, proposalRepo} = setup();

        await service.inbox(open, 1);
        await service.inbox({status: "all", kind: "dispute"}, 1);

        expect(proposalRepo.kindCounts).toHaveBeenNthCalledWith(1, {status: "open"});
        expect(proposalRepo.list).toHaveBeenNthCalledWith(1, {status: "open"}, 50, 0);
        expect(proposalRepo.kindCounts).toHaveBeenNthCalledWith(2, {});
        expect(proposalRepo.list).toHaveBeenNthCalledWith(2, {kind: "dispute"}, 50, 0);
    });

    it("has one empty page when there are no proposals", async () => {
        expect(await setup().service.inbox(open, 1)).toEqual(success({items: [], counts: {}, page: 1, pages: 1}));
    });

    it("50 proposals make one page", async () => {
        const {service, proposalRepo} = setup();
        proposalRepo.kindCounts.mockResolvedValue(success({statement: 30, suggestion: 20}));

        expect(await service.inbox(open, 1)).toMatchObject(success({page: 1, pages: 1}));
        expect(await service.inbox(open, 2)).toEqual(failure(AppError.NOT_FOUND));
    });

    it("51 proposals make two pages, the second starting at the 51st", async () => {
        const {service, proposalRepo} = setup();
        proposalRepo.kindCounts.mockResolvedValue(success({statement: 30, suggestion: 21}));

        expect(await service.inbox(open, 2)).toMatchObject(success({page: 2, pages: 2}));
        expect(proposalRepo.list).toHaveBeenCalledWith({status: "open"}, 50, 50);
    });

    it("counts the pages of the kind shown", async () => {
        const {service, proposalRepo} = setup();
        proposalRepo.kindCounts.mockResolvedValue(success({statement: 120, dispute: 3}));

        expect(await service.inbox({status: "all", kind: "dispute"}, 1)).toMatchObject(
            success({counts: {statement: 120, dispute: 3}, pages: 1})
        );
        expect(await service.lastPage({status: "all", kind: "statement"})).toEqual(success(3));
    });

    it("an out-of-range page is not found, or the last page when asked to clamp", async () => {
        const {service, proposalRepo} = setup();
        proposalRepo.kindCounts.mockResolvedValue(success({statement: 60}));

        expect(await service.inbox(open, 3)).toEqual(failure(AppError.NOT_FOUND));
        expect(await service.inbox(open, 3, true)).toMatchObject(success({page: 2, pages: 2}));
        expect(proposalRepo.list).toHaveBeenCalledOnce();
        expect(proposalRepo.list).toHaveBeenCalledWith({status: "open"}, 50, 50);
    });

    it("fetches the disputes' statements in one query, each once", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.list.mockResolvedValue(
            success([
                makeProposal({id: 3, kind: "dispute", statementId: "a-statement", body: {}}),
                makeProposal({id: 2, kind: "dispute", statementId: "a-statement", body: {}}),
                makeProposal({id: 1, statementId: "other"}),
            ])
        );

        const result = await service.inbox(open, 1);

        if (!result.ok) throw new Error("expected success");
        expect(statementRepo.bodies).toHaveBeenCalledExactlyOnceWith(["a-statement"]);
        expect(result.data.items.map((i) => i.statement)).toEqual([makeStatement(), makeStatement(), null]);
    });

    it("asks for no statements when the page has no disputes", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.list.mockResolvedValue(success([makeProposal({id: 1})]));

        await service.inbox(open, 1);

        expect(statementRepo.bodies).not.toHaveBeenCalled();
    });

    it("gives a dispute about a removed statement no statement", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.list.mockResolvedValue(success([makeProposal({kind: "dispute", statementId: "gone"})]));
        statementRepo.bodies.mockResolvedValue(success(new Map()));

        const result = await service.inbox(open, 1);

        expect(result.ok && result.data.items[0].statement).toBeNull();
    });

    it("passes a database failure on", async () => {
        const {service, proposalRepo, statementRepo} = setup();
        proposalRepo.kindCounts.mockResolvedValueOnce(failure(AppError.DB_ERROR));
        expect(await service.inbox(open, 1)).toEqual(failure(AppError.DB_ERROR));

        proposalRepo.list.mockResolvedValueOnce(failure(AppError.DB_ERROR));
        expect(await service.inbox(open, 1)).toEqual(failure(AppError.DB_ERROR));

        proposalRepo.list.mockResolvedValueOnce(success([makeProposal({kind: "dispute", statementId: "x"})]));
        statementRepo.bodies.mockResolvedValueOnce(failure(AppError.DB_ERROR));
        expect(await service.inbox(open, 1)).toEqual(failure(AppError.DB_ERROR));
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
