import {Router, type Request, type Response} from "express";
import {AppError} from "../../lib/errors.js";
import {send} from "../../lib/http.js";
import {RECORD_START_DAY, day} from "../../lib/scout.js";
import {getAuth} from "../../middleware/admin-auth.js";
import type ProposalService from "../../services/proposal-service.js";
import type RunService from "../../services/run-service.js";
import type ScoutRunnerService from "../../services/scout-runner-service.js";
import {StartError} from "../../services/scout-runner-service.js";
import {RunView} from "../../ui/views/admin/run.js";
import {RunsView, type RunForm} from "../../ui/views/admin/runs.js";
import {SOMETHING_WENT_WRONG, adminPage, intParam, sendError, withDone} from "./respond.js";

const NO_RUN = "No run with that number.";
const NO_PAGE = "Page not found";
const BUSY = "A run is already going.";
const BAD_SINCE = "Use a date from 2022-11-30 to today, as YYYY-MM-DD.";
const NOT_STARTED = "The scout failed to start.";

function sinceOf(value: unknown, today: string): string | undefined | null {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    if (Number.isNaN(Date.parse(value)) || day(new Date(value)) !== value) return null;
    return value >= RECORD_START_DAY && value <= today ? value : null;
}

export function runsRouter(
    runService: RunService,
    proposalService: ProposalService,
    scoutRunner: ScoutRunnerService
): Router {
    const router = Router();

    async function renderList(req: Request, res: Response, pageNo: number, status = 200, form: RunForm = {}) {
        const page = await adminPage(req, proposalService, "runs");
        const runs = await runService.page(pageNo);
        if (!runs.ok) {
            const missing = runs.ctx === AppError.NOT_FOUND;
            return sendError(res, page, missing ? NO_PAGE : SOMETHING_WENT_WRONG, missing ? 404 : 500);
        }
        const {runs: list, page: current, pages} = runs.data;
        send(
            res,
            RunsView({
                page,
                runs: list,
                pageNo: current,
                pages,
                nextRun: scoutRunner.nextRun(),
                today: day(new Date()),
                form,
            }),
            status
        );
    }

    router.get("/runs", async (req, res) => {
        const raw = req.query.page;
        const pageNo = raw === undefined ? 1 : intParam(raw);
        if (pageNo === null) return sendError(res, await adminPage(req, proposalService, "runs"), NO_PAGE, 404);
        await renderList(req, res, pageNo);
    });

    router.post("/runs", async (req, res) => {
        const dryRun = req.body?.dryRun === "1";
        const since = sinceOf(req.body?.since, day(new Date()));
        const form: RunForm = {since: typeof req.body?.since === "string" ? req.body.since : "", dryRun};
        if (since === null) return renderList(req, res, 1, 400, {...form, error: BAD_SINCE});

        const started = await scoutRunner.start({startedBy: getAuth(req).email, since, dryRun});
        if (!started.ok) {
            if (started.ctx === StartError.BUSY) return renderList(req, res, 1, 409, {...form, error: BUSY});
            const message = started.ctx === StartError.NOT_STARTED ? NOT_STARTED : SOMETHING_WENT_WRONG;
            return renderList(req, res, 1, 500, {...form, error: message});
        }
        res.redirect(302, withDone(`/admin/runs/${started.data}`, "started"));
    });

    router.get("/runs/:id", async (req, res) => {
        const page = await adminPage(req, proposalService, "runs");
        const id = intParam(req.params.id);
        if (id === null) return sendError(res, page, NO_RUN, 404);
        const run = await runService.get(id);
        if (!run.ok) {
            const missing = run.ctx === AppError.NOT_FOUND;
            return sendError(res, page, missing ? NO_RUN : SOMETHING_WENT_WRONG, missing ? 404 : 500);
        }
        const proposals = await runService.proposals(id);
        if (!proposals.ok) return sendError(res, page, SOMETHING_WENT_WRONG, 500);
        send(res, RunView({page, run: run.data, proposals: proposals.data}));
    });

    router.post("/runs/:id/stop", async (req, res) => {
        const id = intParam(req.params.id);
        if (id === null) return sendError(res, await adminPage(req, proposalService, "runs"), NO_RUN, 404);
        const stopped = await scoutRunner.stop(id);
        if (!stopped.ok) {
            const missing = stopped.ctx === AppError.NOT_FOUND;
            const page = await adminPage(req, proposalService, "runs");
            return sendError(res, page, missing ? NO_RUN : SOMETHING_WENT_WRONG, missing ? 404 : 500);
        }
        res.redirect(302, withDone(`/admin/runs/${id}`, "stopped"));
    });

    return router;
}
