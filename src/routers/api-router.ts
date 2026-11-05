import express, {Router, type NextFunction, type Request, type Response} from "express";
import type ContentService from "../services/content-service.js";
import {isUrl} from "../lib/statement-rules.js";
import type LeagueService from "../services/league-service.js";
import type FeedbackService from "../services/feedback-service.js";
import type {Slot} from "../services/feedback-service.js";

const COMMENT_CHARS = 500;
const QUOTE_CHARS = 1_000;
const URL_CHARS = 2_000;
const WEBSITE_CHARS = 200;
const BODY_LIMIT = "8kb";
const DIRECTIONS = ["more", "fewer"];

export type ApiDeps = {
    feedbackService: FeedbackService;
    leagueService: LeagueService;
    content: ContentService;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const address = (req: Request) => req.ip ?? "";

const slotOf = (res: Response) => res.locals.feedbackSlot as Slot;

function isSameSite(req: Request): boolean {
    const site = req.get("sec-fetch-site");
    const origin = req.get("origin");
    if (site) return site === "same-origin";
    return origin ? URL.parse(origin)?.host === req.get("host") : false;
}

export function makeApiRouter({feedbackService, leagueService, content}: ApiDeps): Router {
    const router = Router();

    router.use(express.json({limit: BODY_LIMIT}));
    router.use((req, res, next) => {
        if (!isSameSite(req) || !req.is("application/json")) {
            res.status(403).json({error: "Send it from the site."});
            return;
        }
        // a bot that fills the hidden website field is told it worked
        if (text(req.body?.website, WEBSITE_CHARS) !== "") {
            res.status(202).json({ok: true});
            return;
        }
        const slot = feedbackService.reserve(address(req));
        if (!slot) {
            res.status(429).json({error: "That is a lot of feedback. Try again later."});
            return;
        }
        res.on("close", () => slot.release());
        res.locals.feedbackSlot = slot;
        next();
    });

    router.post("/dispute", async (req, res, next) => {
        const {statementId, category, direction} = req.body ?? {};
        const league = await leagueService.get();
        if (!league.ok) return next(new Error(`failed to load the league: ${league.ctx}`));
        if (typeof statementId !== "string" || !league.data.byId.has(statementId)) {
            res.status(400).json({error: "No such statement."});
            return;
        }
        if (!content.get().rubric.categories.some((c) => c.id === category)) {
            res.status(400).json({error: "Pick one of the counts."});
            return;
        }
        if (!DIRECTIONS.includes(direction)) {
            res.status(400).json({error: "More or fewer?"});
            return;
        }
        const taken = await feedbackService.dispute(slotOf(res), {
            statementId,
            category,
            direction,
            comment: text(req.body.comment, COMMENT_CHARS),
        });
        if (!taken.ok) return next(new Error(`failed to save a dispute: ${taken.ctx}`));
        res.status(202).json({ok: true});
    });

    router.post("/suggest", async (req, res, next) => {
        const url = text(req.body?.url, URL_CHARS);
        if (!isUrl(url)) {
            res.status(400).json({error: "A link to where it was said or reported, please."});
            return;
        }
        const ceo = content.get().ceos.some((c) => c.id === req.body?.ceo) ? (req.body.ceo as string) : null;
        const taken = await feedbackService.suggest(slotOf(res), {
            url,
            ceo,
            quote: text(req.body?.quote, QUOTE_CHARS),
            note: text(req.body?.note, COMMENT_CHARS),
        });
        if (!taken.ok) return next(new Error(`failed to save a suggestion: ${taken.ctx}`));
        res.status(202).json({ok: true});
    });

    router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
        const {type, status} = (err ?? {}) as {type?: string; status?: number};
        if (type?.startsWith("entity.") || type === "charset.unsupported" || type === "encoding.unsupported") {
            res.sendStatus(status ?? 400);
            return;
        }
        next(err);
    });

    return router;
}
