import {Router, type Request, type Response} from "express";
import type ContentService from "../../services/content-service.js";
import {send} from "../../lib/http.js";
import type StatementRepository from "../../repositories/statement-repository.js";
import type {StatementWithHistory} from "../../repositories/statement-repository.js";
import type ProposalService from "../../services/proposal-service.js";
import type StatementService from "../../services/statement-service.js";
import {WriteError} from "../../services/statement-service.js";
import {editorValues} from "../../ui/components/admin-parts.js";
import {StatementView, type StatementViewProps} from "../../ui/views/admin/statement.js";
import {StatementsView} from "../../ui/views/admin/statements.js";
import {readEditor} from "./editor-form.js";
import {SOMETHING_WENT_WRONG, adminPage, sendError, withDone} from "./respond.js";

const NO_STATEMENT = "No statement with that id.";

type Rerender = Omit<StatementViewProps, "page" | "content" | "row">;

export function statementsRouter(
    statementRepo: StatementRepository,
    statementService: StatementService,
    proposalService: ProposalService,
    content: ContentService
): Router {
    const router = Router();

    const pathOf = (id: string) => `/admin/statements/${encodeURIComponent(id)}`;

    async function render(req: Request, res: Response, status = 200, props: Rerender = {}, toast?: string) {
        const page = await adminPage(req, proposalService, "statements", toast);
        const row = await statementRepo.get(String(req.params.id));
        if (!row.ok) return sendError(res, page, SOMETHING_WENT_WRONG, 500);
        if (!row.data) return sendError(res, page, NO_STATEMENT, 404);
        send(res, StatementView({page, content: content.get(), row: row.data, ...props}), status);
    }

    function loaded(row: StatementWithHistory, load: unknown) {
        return row.history.find((v) => String(v.id) === load);
    }

    router.get("/statements", async (req, res) => {
        const page = await adminPage(req, proposalService, "statements");
        const statements = await statementRepo.listAll();
        if (!statements.ok) return sendError(res, page, SOMETHING_WENT_WRONG, 500);
        const q = typeof req.query.q === "string" ? req.query.q : "";
        send(res, StatementsView({page, content: content.get(), statements: statements.data, q}));
    });

    router.get("/statements/:id", async (req, res) => {
        if (req.query.load === undefined) return render(req, res);
        const row = await statementRepo.get(req.params.id);
        const version = row.ok && row.data ? loaded(row.data, req.query.load) : undefined;
        if (!version) return render(req, res);
        render(req, res, 200, {values: editorValues(version.body)}, "Loaded into the editor. Save to restore it.");
    });

    router.post("/statements/:id", async (req, res) => {
        const id = req.params.id;
        const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
        const form = readEditor(req.body ?? {}, content.get().rubric);
        if (!form.ok) {
            return render(req, res, 422, {values: form.ctx.values, note, error: {message: form.ctx.message}});
        }
        const result = await statementService.save(id, form.data.statement, note || "edited");
        if (!result.ok) {
            const kept = {values: form.data.values, note};
            switch (result.ctx.code) {
                case WriteError.NOT_FOUND:
                    return sendError(res, await adminPage(req, proposalService, "statements"), NO_STATEMENT, 404);
                case WriteError.ID_CHANGED:
                    return render(req, res, 400, {...kept, error: {message: "The id cannot change."}});
                case WriteError.INVALID:
                    return render(req, res, 422, {
                        ...kept,
                        error: {message: "The statement is not valid.", errors: result.ctx.errors},
                    });
                default:
                    return render(req, res, 500, {...kept, error: {message: SOMETHING_WENT_WRONG}});
            }
        }
        res.redirect(302, withDone(pathOf(id), "saved"));
    });

    router.post("/statements/:id/published", async (req, res) => {
        const id = req.params.id;
        const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
        const published = req.body?.published;
        if (published !== "1" && published !== "0") {
            return render(req, res, 400, {note, error: {message: "published must be true or false."}});
        }
        const result = await statementService.setPublished(id, published === "1", note || null);
        if (!result.ok) {
            if (result.ctx.code === WriteError.NOT_FOUND) {
                return sendError(res, await adminPage(req, proposalService, "statements"), NO_STATEMENT, 404);
            }
            return render(req, res, 500, {note, error: {message: SOMETHING_WENT_WRONG}});
        }
        res.redirect(302, withDone(pathOf(id), published === "1" ? "shown" : "hidden"));
    });

    return router;
}
