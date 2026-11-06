import type {Request, Response} from "express";
import {send} from "../../lib/http.js";
import type {AdminTab} from "../../ui/components/admin-layout.js";
import type {AdminPage} from "../../ui/views/admin/page.js";
import {ErrorView} from "../../ui/views/admin/error.js";
import type ProposalService from "../../services/proposal-service.js";

export const SOMETHING_WENT_WRONG = "Something went wrong.";

export const DONE = {
    published: "Published.",
    rejected: "Rejected.",
    closed: "Closed.",
    saved: "Saved.",
    added: "Added.",
    deleted: "Deleted.",
    hidden: "Hidden from the site.",
    shown: "Back on the site.",
    started: "Started.",
    stopped: "Stopped.",
    removed: "Removed.",
} as const;

export type Done = keyof typeof DONE;

export function withDone(href: string, done: Done): string {
    return `${href}${href.includes("?") ? "&" : "?"}done=${done}`;
}

export function toastOf(req: Request): string | undefined {
    const done = req.query.done;
    return typeof done === "string" && Object.hasOwn(DONE, done) ? DONE[done as Done] : undefined;
}

export async function adminPage(
    req: Request,
    proposalService: ProposalService,
    tab?: AdminTab,
    toast = toastOf(req)
): Promise<AdminPage> {
    const open = await proposalService.openTotal();
    return {tab, open: open.ok ? open.data : 0, toast};
}

export function sendError(res: Response, page: AdminPage, message: string, status: number) {
    send(res, ErrorView(message, page), status);
}

export function intParam(value: unknown): number | null {
    const n = Number(value);
    return typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(n) && n > 0 ? n : null;
}
