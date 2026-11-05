import {Router} from "express";
import type ProposalService from "../../services/proposal-service.js";
import {adminPage, sendError} from "./respond.js";

export function notFoundRouter(proposalService: ProposalService): Router {
    const router = Router();
    router.use(async (req, res) => {
        sendError(res, await adminPage(req, proposalService), "Page not found", 404);
    });
    return router;
}
