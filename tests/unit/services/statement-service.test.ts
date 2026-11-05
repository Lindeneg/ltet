import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import StatementService, {WriteError} from "../../../src/services/statement-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import {fake, makeProposal, makeStatement, makeStatementRecord, makeContentService} from "../helpers.js";

function setup() {
    const statementRepo = {
        get: vi.fn().mockResolvedValue(success({...makeStatementRecord(), history: []})),
        has: vi.fn().mockResolvedValue(success(false)),
        save: vi.fn().mockResolvedValue(success(false)),
        setPublished: vi.fn().mockResolvedValue(success(true)),
    };
    const proposalRepo = {
        get: vi.fn().mockResolvedValue(success(makeProposal())),
        decide: vi.fn().mockResolvedValue(success(true)),
    };
    const onChange = vi.fn();
    const service = new StatementService(
        fake<StatementRepository>(statementRepo),
        fake<ProposalRepository>(proposalRepo),
        makeContentService(),
        onChange
    );
    return {service, statementRepo, proposalRepo, onChange};
}

const id = makeStatement().id;

describe("StatementService", () => {
    describe("save", () => {
        it("keeps the statement's origin and whether it is live", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.get.mockResolvedValue(
                success({...makeStatementRecord({origin: "scout", published: false}), history: []})
            );
            const edited = makeStatement({context: "New context."});

            expect(await service.save(id, edited, "fixed the context")).toEqual(success(undefined));
            expect(statementRepo.save).toHaveBeenCalledWith(edited, {
                origin: "scout",
                published: false,
                note: "fixed the context",
            });
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("refuses a statement that does not exist", async () => {
            const {service, statementRepo} = setup();
            statementRepo.get.mockResolvedValue(success(null));

            expect(await service.save(id, makeStatement(), "edited")).toEqual(
                failure({code: WriteError.NOT_FOUND, errors: []})
            );
        });

        it("refuses a changed id", async () => {
            const {service, statementRepo} = setup();

            expect(await service.save(id, makeStatement({id: "other-id"}), "edited")).toEqual(
                failure({code: WriteError.ID_CHANGED, errors: []})
            );
            expect(statementRepo.save).not.toHaveBeenCalled();
        });

        it("refuses an invalid statement with its problems", async () => {
            const {service, statementRepo, onChange} = setup();

            const result = await service.save(id, makeStatement({quote: ""}), "edited");

            expect(result).toEqual(failure({code: WriteError.INVALID, errors: ["quote missing"]}));
            expect(statementRepo.save).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
        });

        it("passes a database failure on", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.save.mockResolvedValue(failure(AppError.DB_ERROR));

            expect(await service.save(id, makeStatement(), "edited")).toEqual(
                failure({code: AppError.DB_ERROR, errors: []})
            );
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe("setPublished", () => {
        it("hides a statement and reports the change", async () => {
            const {service, statementRepo, onChange} = setup();

            expect(await service.setPublished(id, false, "not fair")).toEqual(success(undefined));
            expect(statementRepo.setPublished).toHaveBeenCalledWith(id, false, "not fair");
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("refuses a statement that does not exist", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.setPublished.mockResolvedValue(success(false));

            expect(await service.setPublished(id, true, null)).toEqual(
                failure({code: WriteError.NOT_FOUND, errors: []})
            );
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe("approve", () => {
        it("publishes the statement and closes the proposal", async () => {
            const {service, statementRepo, proposalRepo, onChange} = setup();
            const statement = makeStatement();

            expect(await service.approve(1, statement)).toEqual(success(id));
            expect(statementRepo.save).toHaveBeenCalledWith(statement, {
                origin: "scout",
                note: "approved from proposal 1",
            });
            expect(proposalRepo.decide).toHaveBeenCalledWith(1, "approved");
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("refuses a proposal that is not open", async () => {
            const {service, proposalRepo} = setup();
            proposalRepo.get.mockResolvedValue(success(makeProposal({status: "rejected"})));

            expect(await service.approve(1, makeStatement())).toEqual(failure({code: WriteError.NOT_OPEN, errors: []}));
        });

        it("refuses a missing proposal", async () => {
            const {service, proposalRepo} = setup();
            proposalRepo.get.mockResolvedValue(success(null));

            expect(await service.approve(1, makeStatement())).toEqual(failure({code: WriteError.NOT_OPEN, errors: []}));
        });

        it("refuses a suggestion or a dispute", async () => {
            const {service, proposalRepo} = setup();
            proposalRepo.get.mockResolvedValue(success(makeProposal({kind: "dispute"})));

            expect(await service.approve(1, makeStatement())).toEqual(
                failure({code: WriteError.NOT_A_STATEMENT, errors: []})
            );
        });

        it("refuses an id that exists already", async () => {
            const {service, statementRepo, proposalRepo} = setup();
            statementRepo.has.mockResolvedValue(success(true));

            expect(await service.approve(1, makeStatement())).toEqual(
                failure({code: WriteError.INVALID, errors: [`a statement with the id ${id} exists already`]})
            );
            expect(statementRepo.save).not.toHaveBeenCalled();
            expect(proposalRepo.decide).not.toHaveBeenCalled();
        });
    });
});
