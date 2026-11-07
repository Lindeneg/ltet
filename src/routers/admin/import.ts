import express, {Router, type Request, type Response} from "express";
import {MAX_IMPORT_FORM_BYTES, send} from "../../lib/http.js";
import {parseImport} from "../../lib/statement-import.js";
import type ProposalService from "../../services/proposal-service.js";
import type StatementService from "../../services/statement-service.js";
import {ImportView} from "../../ui/views/admin/import.js";
import {SOMETHING_WENT_WRONG, adminPage} from "./respond.js";

export function importRouter(statementService: StatementService, proposalService: ProposalService): Router {
    const router = Router();

    const page = (req: Request) => adminPage(req, proposalService, "statements");

    async function run(req: Request, res: Response, apply: boolean) {
        const text = typeof req.body?.edits === "string" ? req.body.edits : "";
        const edits = parseImport(text);
        if (!edits.ok) return send(res, ImportView({page: await page(req), text, error: edits.ctx}), 422);
        const plan = apply
            ? await statementService.applyImport(edits.data)
            : await statementService.planImport(edits.data);
        if (!plan.ok) return send(res, ImportView({page: await page(req), text, error: SOMETHING_WENT_WRONG}), 500);
        send(res, ImportView({page: await page(req), text, plan: plan.data, applied: apply}));
    }

    router.get("/import", async (req, res) => send(res, ImportView({page: await page(req)})));
    const form = express.urlencoded({extended: true, limit: MAX_IMPORT_FORM_BYTES});
    router.post("/import/preview", form, (req, res) => run(req, res, false));
    router.post("/import/apply", form, (req, res) => run(req, res, true));

    return router;
}
