import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError, type DbError} from "../lib/errors.js";
import type RunRepository from "../repositories/run-repository.js";
import type {RunListItem, RunProposal, RunRecord} from "../repositories/run-repository.js";

const SHOWN = 30;

export type RunPage = {runs: RunListItem[]; page: number; pages: number};

class RunService {
    constructor(private readonly runRepo: RunRepository) {}

    list(): AsyncResult<RunListItem[], DbError> {
        return this.runRepo.list(SHOWN);
    }

    async page(page: number): AsyncResult<RunPage, DbError> {
        const total = await this.runRepo.count();
        if (!total.ok) return total;
        const pages = Math.max(1, Math.ceil(total.data / SHOWN));
        if (page > pages) return failure(AppError.NOT_FOUND);
        const runs = await this.runRepo.list(SHOWN, (page - 1) * SHOWN);
        if (!runs.ok) return runs;
        return success({runs: runs.data, page, pages});
    }

    async get(id: number): AsyncResult<RunRecord, DbError> {
        const run = await this.runRepo.get(id);
        if (!run.ok) return run;
        return run.data ? success(run.data) : failure(AppError.NOT_FOUND);
    }

    proposals(id: number): AsyncResult<RunProposal[], DbError> {
        return this.runRepo.proposals(id);
    }
}

export default RunService;
