import {Router, type Request, type Response, type NextFunction} from "express";
import {AppError} from "../lib/errors.js";
import {baseUrl, send} from "../lib/http.js";
import {failure, type Result} from "../lib/result.js";
import type {MaybeNull, MaybeUndefined} from "../lib/types.js";
import type PageService from "../services/page-service.js";
import type {SeasonPage} from "../services/page-service.js";

const SEASON_SEGMENT = /^\d{2}-\d{2}$/;

type SeasonHandler = (page: SeasonPage, req: Request) => Promise<Result<string, AppError>>;

function stringParams<K extends string>(req: Request, names: K[]): MaybeNull<Partial<Record<K, string>>> {
    const params: Partial<Record<K, string>> = {};
    for (const name of names) {
        const value = req.query[name];
        if (value === undefined) continue;
        if (typeof value !== "string") return null;
        params[name] = value;
    }
    return params;
}

export type PublicDeps = {
    pageService: PageService;
    publicUrl: MaybeUndefined<string>;
};

export function makePublicRouter({pageService, publicUrl}: PublicDeps): Router {
    const router = Router();

    const sendNotFound = async (res: Response) => send(res, await pageService.getNotFound(), 404);

    const sendServerError = async (res: Response) => send(res, await pageService.getServerError(), 500);

    const sendResult = async (res: Response, result: Result<string, AppError>) => {
        if (result.ok) return send(res, result.data);
        if (result.ctx === AppError.NOT_FOUND) return sendNotFound(res);
        await sendServerError(res);
    };

    router.get(/^\/all-time(\/.*)?$/, (req, res) => {
        const path = (req.params[0] ?? "/").replace(/^[/\\]+/, "/");
        const at = req.originalUrl.indexOf("?");
        res.redirect(301, at === -1 ? path : path + req.originalUrl.slice(at));
    });

    const seasonal = (path: string, handler: SeasonHandler) => {
        const run = async (season: MaybeUndefined<string>, req: Request, res: Response) => {
            await sendResult(res, await handler({season}, req));
        };
        router.get(path, (req, res) => run(undefined, req, res));
        router.get(`/:season${path === "/" ? "" : path}`, (req: Request, res: Response, next: NextFunction) => {
            const season = req.params.season as string;
            if (!SEASON_SEGMENT.test(season)) return next();
            return run(season, req, res);
        });
    };

    seasonal("/", (page, req) => pageService.getTable(page, baseUrl(req, publicUrl)));
    seasonal("/results", async (page, req) => {
        const query = stringParams(req, ["ceo", "count", "sort"]);
        if (!query) return failure(AppError.NOT_FOUND);
        return pageService.getResults(page, query);
    });

    router.get("/match/:id", async (req, res) => {
        await sendResult(res, await pageService.getMatch(req.params.id));
    });

    seasonal("/race", (page) => pageService.getRace(page));
    seasonal("/honours", (page) => pageService.getHonours(page));
    seasonal("/club/:id", (page, req) => pageService.getClub(page, req.params.id as string));
    router.get("/rules", async (_req, res) => sendResult(res, await pageService.getRules()));

    router.use(async (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        if (/\.[a-z0-9]+$/i.test(req.path)) {
            res.status(404).type("text").send("Not found");
            return;
        }
        await sendNotFound(res);
    });

    router.use(async (error: unknown, req: Request, res: Response, next: NextFunction) => {
        req.log.error(error, "failed to render a page");
        if (res.headersSent) return next(error);
        await sendServerError(res);
    });

    return router;
}
