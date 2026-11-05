import {describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import RunService from "../../../src/services/run-service.js";
import type RunRepository from "../../../src/repositories/run-repository.js";
import {fake, makeRun} from "../helpers.js";

describe("RunService", () => {
    it("lists the last 30 runs", async () => {
        const list = vi.fn().mockResolvedValue(success([]));

        await new RunService(fake<RunRepository>({list})).list();

        expect(list).toHaveBeenCalledWith(30);
    });

    it("gets a run or reports it missing", async () => {
        const get = vi.fn().mockResolvedValue(success(makeRun()));
        const service = new RunService(fake<RunRepository>({get}));

        expect(await service.get(1)).toEqual(success(makeRun()));
        get.mockResolvedValue(success(null));
        expect(await service.get(2)).toEqual(failure(AppError.NOT_FOUND));
    });

    it("pages through every run, 30 a page, and has no page past the last", async () => {
        const count = vi.fn().mockResolvedValue(success(61));
        const list = vi.fn().mockResolvedValue(success([makeRun()]));
        const service = new RunService(fake<RunRepository>({count, list}));

        expect(await service.page(3)).toEqual(success({runs: [makeRun()], page: 3, pages: 3}));
        expect(list).toHaveBeenCalledWith(30, 60);
        expect(await service.page(4)).toEqual(failure(AppError.NOT_FOUND));
    });

    it("has one empty page when there are no runs", async () => {
        const service = new RunService(
            fake<RunRepository>({
                count: vi.fn().mockResolvedValue(success(0)),
                list: vi.fn().mockResolvedValue(success([])),
            })
        );

        expect(await service.page(1)).toEqual(success({runs: [], page: 1, pages: 1}));
    });

    it("lists the proposals a run made", async () => {
        const proposals = vi.fn().mockResolvedValue(success([{id: 4, statementId: "x"}]));

        expect(await new RunService(fake<RunRepository>({proposals})).proposals(2)).toEqual(
            success([{id: 4, statementId: "x"}])
        );
        expect(proposals).toHaveBeenCalledWith(2);
    });
});
