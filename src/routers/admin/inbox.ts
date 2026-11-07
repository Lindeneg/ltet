import {Router, type Request, type Response} from "express";
import type ContentService from "../../services/content-service.js";
import {send} from "../../lib/http.js";
import {AppError} from "../../lib/errors.js";
import type ProposalService from "../../services/proposal-service.js";
import type {InboxStatus} from "../../services/proposal-service.js";
import type StatementService from "../../services/statement-service.js";
import {WriteError} from "../../services/statement-service.js";
import {InboxView, KINDS, inboxHref, type CardError, type InboxKind} from "../../ui/views/admin/inbox.js";
import {readEditor} from "./editor-form.js";
import {SOMETHING_WENT_WRONG, adminPage, intParam, sendError, withDone, type Done} from "./respond.js";

const NO_OPEN_PROPOSAL = "No open proposal with that number.";
const NO_PAGE = "Page not found";

type View = {kind: InboxKind; status: InboxStatus; page: number};

function viewOf(kind: unknown, status: unknown, page: unknown): View {
    return {
        kind: KINDS.some((k) => k.id === kind) ? (kind as InboxKind) : "all",
        status: status === "all" ? "all" : "open",
        page: intParam(page) ?? 1,
    };
}

const filterOf = (view: View) => ({status: view.status, kind: view.kind === "all" ? null : view.kind});

const noteOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function inboxRouter(
    proposalService: ProposalService,
    statementService: StatementService,
    content: ContentService
): Router {
    const router = Router();

    async function render(req: Request, res: Response, view: View, status = 200, failed?: {id: number} & CardError) {
        const page = await adminPage(req, proposalService, "inbox");
        const inbox = await proposalService.inbox(filterOf(view), view.page, failed !== undefined);
        if (!inbox.ok) {
            const missing = inbox.ctx === AppError.NOT_FOUND;
            return sendError(res, page, missing ? NO_PAGE : SOMETHING_WENT_WRONG, missing ? 404 : 500);
        }
        const {items, counts, page: pageNo, pages} = inbox.data;
        send(
            res,
            InboxView({
                page,
                content: content.get(),
                items,
                counts,
                kind: view.kind,
                status: view.status,
                pageNo,
                pages,
                failed,
            }),
            status
        );
    }

    async function back(res: Response, view: View, done: Done) {
        const last = view.page > 1 ? await proposalService.lastPage(filterOf(view)) : undefined;
        const page = last?.ok ? Math.min(view.page, last.data) : 1;
        res.redirect(302, withDone(inboxHref(view.kind, view.status, page), done));
    }

    router.get("/", async (req, res) => {
        const raw = req.query.page;
        if (raw !== undefined && intParam(raw) === null) {
            return sendError(res, await adminPage(req, proposalService, "inbox"), NO_PAGE, 404);
        }
        await render(req, res, viewOf(req.query.kind, req.query.status, raw));
    });

    router.post("/proposals/:id/approve", async (req, res) => {
        const view = viewOf(req.body?.kind, req.body?.view, req.body?.page);
        const note = noteOf(req.body?.note);
        const id = intParam(req.params.id);
        if (id === null) return sendError(res, await adminPage(req, proposalService, "inbox"), NO_OPEN_PROPOSAL, 404);

        const failed = (code: WriteError, values?: CardError["values"], errors: string[] = []) => {
            const card = {id, values, note};
            switch (code) {
                case WriteError.NOT_OPEN:
                    return render(req, res, view, 404, {...card, message: NO_OPEN_PROPOSAL});
                case WriteError.NOT_A_STATEMENT:
                    return render(req, res, view, 400, {
                        ...card,
                        message: "Only a proposed statement can be approved; close the others.",
                    });
                case WriteError.INVALID:
                    return render(req, res, view, 422, {...card, message: "The statement is not valid yet.", errors});
                default:
                    return render(req, res, view, 500, {...card, message: SOMETHING_WENT_WRONG});
            }
        };

        const approvable = await statementService.approvable(id);
        if (!approvable.ok) return failed(approvable.ctx.code);

        const form = readEditor(req.body ?? {}, content.get().rubric);
        if (!form.ok)
            return render(req, res, view, 422, {id, message: form.ctx.message, values: form.ctx.values, note});

        const result = await statementService.approve(id, form.data.statement);
        if (!result.ok) return failed(result.ctx.code, form.data.values, result.ctx.errors);
        await back(res, view, "published");
    });

    router.post("/proposals/:id/close", async (req, res) => {
        const view = viewOf(req.body?.kind, req.body?.view, req.body?.page);
        const note = noteOf(req.body?.note);
        const id = intParam(req.params.id);
        if (id === null) return sendError(res, await adminPage(req, proposalService, "inbox"), NO_OPEN_PROPOSAL, 404);

        const status = req.body?.status;
        if (status !== "rejected" && status !== "done") {
            return render(req, res, view, 400, {id, note, message: 'status must be "rejected" or "done".'});
        }
        const result = await proposalService.close(id, status, note || null);
        if (!result.ok) {
            const missing = result.ctx === AppError.NOT_FOUND;
            return render(req, res, view, missing ? 404 : 500, {
                id,
                note,
                message: missing ? NO_OPEN_PROPOSAL : SOMETHING_WENT_WRONG,
            });
        }
        await back(res, view, status === "rejected" ? "rejected" : "closed");
    });

    return router;
}
