import {Router, type NextFunction, type Response} from "express";
import {baseUrl, send} from "../lib/http.js";
import type ContentService from "../services/content-service.js";
import type LeagueService from "../services/league-service.js";
import type {League} from "../services/league-service.js";
import PreviewService, {OG_HEIGHT, OG_WIDTH} from "../services/preview-service.js";
import {maxPitchforks} from "../lib/score.js";
import {matchImageAlt} from "../ui/components/seo.js";
import {ShareView} from "../ui/views/site/share.js";

const IMAGE_MAX_AGE_SECONDS = 86_400;
const DESCRIPTION_QUOTE_CHARS = 180;

const dayFormat = new Intl.DateTimeFormat("en-GB", {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"});

export type PreviewsDeps = {
    leagueService: LeagueService;
    previewService: PreviewService;
    content: ContentService;
    publicUrl: string | undefined;
};

function sendPng(res: Response, png: Buffer) {
    res.type("png").set("Cache-Control", `public, max-age=${IMAGE_MAX_AGE_SECONDS}`).send(png);
}

export function makePreviewsRouter({leagueService, previewService, content, publicUrl}: PreviewsDeps): Router {
    const router = Router();

    const league = async (next: NextFunction): Promise<League | undefined> => {
        const result = await leagueService.get();
        if (result.ok) return result.data;
        next(new Error(`failed to load the league: ${result.ctx}`));
        return undefined;
    };

    router.get("/s/:id", async (req, res, next) => {
        const current = await league(next);
        if (!current) return;
        const statement = current.byId.get(req.params.id);
        if (!statement) return res.redirect(302, "/");
        const base = baseUrl(req, publicUrl);
        const quote =
            statement.quote.length > DESCRIPTION_QUOTE_CHARS
                ? `${statement.quote.slice(0, DESCRIPTION_QUOTE_CHARS).trimEnd()}…`
                : statement.quote;
        const {rubric} = content.get();
        const units = rubric.unit;
        const unit = statement.forks === 1 ? units.one : units.many;
        send(
            res,
            ShareView({
                statement,
                url: `${base}/s/${statement.id}`,
                image: {
                    url: `${base}/og/${statement.id}.png`,
                    width: OG_WIDTH,
                    height: OG_HEIGHT,
                    alt: matchImageAlt(statement, unit, maxPitchforks(rubric)),
                },
                description: `${statement.forks} ${unit}. “${quote}” ${statement.who.name}, ${dayFormat.format(new Date(statement.time))}.`,
                target: `/match/${encodeURIComponent(statement.id)}`,
                canonical: `${base}/match/${encodeURIComponent(statement.id)}`,
            })
        );
    });

    router.get("/og.png", async (_req, res, next) => {
        const current = await league(next);
        if (!current) return;
        const key = current.defaultKey;
        const png = await previewService.siteCard(key, () => {
            const context = current.context(key);
            return {standings: context.standings, statements: context.statements};
        });
        sendPng(res, png);
    });

    router.get("/og/:file", async (req, res, next) => {
        const {file} = req.params;
        if (!file.endsWith(".png")) return next();
        const current = await league(next);
        if (!current) return;
        const statement = current.byId.get(file.slice(0, -".png".length));
        if (!statement) return next();
        sendPng(res, await previewService.statementCard(statement));
    });

    return router;
}
