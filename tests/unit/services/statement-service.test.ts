import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import {SkipReason} from "../../../src/lib/statement-import.js";
import StatementService, {IMPORT_NOTE, WriteError} from "../../../src/services/statement-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import {fake, makeProposal, makeStatement, makeStatementRecord, makeContentService} from "../helpers.js";

function setup() {
    const statementRepo = {
        get: vi.fn().mockResolvedValue(success({...makeStatementRecord(), history: []})),
        has: vi.fn().mockResolvedValue(success(false)),
        save: vi.fn().mockResolvedValue(success(false)),
        setPublished: vi.fn().mockResolvedValue(success(true)),
        approve: vi.fn().mockResolvedValue(success(true)),
        listAll: vi.fn().mockResolvedValue(success([makeStatementRecord()])),
        replaceMany: vi
            .fn()
            .mockImplementation(async (items: {body: {id: string}}[]) => success(items.map((item) => item.body.id))),
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
            expect(statementRepo.approve).toHaveBeenCalledWith(1, statement, "scout");
            expect(statementRepo.save).not.toHaveBeenCalled();
            expect(proposalRepo.decide).not.toHaveBeenCalled();
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("reports a proposal closed before the commit and changes nothing", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.approve.mockResolvedValue(success(false));

            expect(await service.approve(1, makeStatement())).toEqual(failure({code: WriteError.NOT_OPEN, errors: []}));
            expect(onChange).not.toHaveBeenCalled();
        });

        it("reports a statement saved with the id before the commit as existing", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.approve.mockResolvedValue(failure(AppError.CONFLICT));

            expect(await service.approve(1, makeStatement())).toEqual(
                failure({code: WriteError.INVALID, errors: [`a statement with the id ${id} exists already`]})
            );
            expect(onChange).not.toHaveBeenCalled();
        });

        it("passes a database failure on without a change", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.approve.mockResolvedValue(failure(AppError.DB_ERROR));

            expect(await service.approve(1, makeStatement())).toEqual(failure({code: AppError.DB_ERROR, errors: []}));
            expect(onChange).not.toHaveBeenCalled();
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
            expect(statementRepo.approve).not.toHaveBeenCalled();
        });
    });

    describe("approvable", () => {
        it("gives the open proposed statement", async () => {
            const {service} = setup();

            expect(await service.approvable(1)).toEqual(success(makeProposal()));
        });

        it("refuses a closed proposal and another kind", async () => {
            const {service, proposalRepo} = setup();
            proposalRepo.get.mockResolvedValue(success(makeProposal({status: "approved"})));
            expect(await service.approvable(1)).toEqual(failure({code: WriteError.NOT_OPEN, errors: []}));

            proposalRepo.get.mockResolvedValue(success(makeProposal({kind: "suggestion"})));
            expect(await service.approvable(1)).toEqual(failure({code: WriteError.NOT_A_STATEMENT, errors: []}));
        });
    });

    describe("imports", () => {
        const other = makeStatement({id: "musk-2025-01-01-other", ceo: "musk"});
        const venue = (to: string, from = "An interview") => ({venue: {from, to}});

        it("plans without writing", async () => {
            const {service, statementRepo, onChange} = setup();
            const plan = await service.planImport([{id, set: venue("A podcast")}]);
            expect(plan.ok && plan.data.ready.map((item) => item.id)).toEqual([id]);
            expect(statementRepo.replaceMany).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
        });

        it("writes every ready statement in one call with the import's note and calls onChange once", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.listAll.mockResolvedValue(
                success([makeStatementRecord(), makeStatementRecord({id: other.id, body: other})])
            );
            const result = await service.applyImport([
                {id, set: venue("A podcast")},
                {id: other.id, set: venue("A speech")},
            ]);
            expect(statementRepo.replaceMany).toHaveBeenCalledTimes(1);
            const [items, note] = statementRepo.replaceMany.mock.calls[0];
            expect(items.map((item: {body: {venue: string}}) => item.body.venue)).toEqual(["A podcast", "A speech"]);
            expect(note).toBe(IMPORT_NOTE);
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(result.ok && result.data.ready).toHaveLength(2);
        });

        it("applies the good statements and leaves one with a skipped edit out", async () => {
            const {service, statementRepo} = setup();
            statementRepo.listAll.mockResolvedValue(
                success([makeStatementRecord(), makeStatementRecord({id: other.id, body: other})])
            );
            const result = await service.applyImport([
                {id, set: {...venue("A podcast"), context: {from: "Stale.", to: "New."}}},
                {id: other.id, set: venue("A speech")},
            ]);
            const [items] = statementRepo.replaceMany.mock.calls[0];
            expect(items.map((item: {id: string}) => item.id)).toEqual([other.id]);
            expect(result.ok && result.data.skipped).toEqual([
                {id, reasons: [{path: "context", reason: SkipReason.STALE}]},
            ]);
        });

        it("writes nothing and skips onChange when nothing is ready", async () => {
            const {service, statementRepo, onChange} = setup();
            const result = await service.applyImport([{id, set: venue("A podcast", "Stale")}]);
            expect(statementRepo.replaceMany).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            expect(result.ok && result.data.skipped).toHaveLength(1);
        });

        it("reports a statement changed during the import as skipped", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.replaceMany.mockResolvedValue(success([]));
            const result = await service.applyImport([{id, set: venue("A podcast")}]);
            expect(result.ok && result.data).toEqual({
                ready: [],
                unchanged: [],
                skipped: [{id, reasons: [{reason: SkipReason.CHANGED}]}],
            });
            expect(onChange).not.toHaveBeenCalled();
        });

        it("fails on a database error without onChange", async () => {
            const {service, statementRepo, onChange} = setup();
            statementRepo.replaceMany.mockResolvedValue(failure(AppError.DB_ERROR));
            const result = await service.applyImport([{id, set: venue("A podcast")}]);
            expect(result).toEqual(failure({code: AppError.DB_ERROR, errors: []}));
            expect(onChange).not.toHaveBeenCalled();
        });

        it("fails when the statements cannot be read", async () => {
            const {service, statementRepo} = setup();
            statementRepo.listAll.mockResolvedValue(failure(AppError.DB_ERROR));
            expect(await service.planImport([{id, set: venue("A podcast")}])).toEqual(
                failure({code: AppError.DB_ERROR, errors: []})
            );
        });
    });
});
