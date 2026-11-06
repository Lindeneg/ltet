import type {Server} from "node:http";
import express, {static as expressStatic, type Request, type Response, type NextFunction, type Router} from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import {failure, emptySuccess, type EmptyResult} from "../lib/result.js";
import {MAX_FORM_BYTES} from "../lib/http.js";
import type {MaybeNull} from "../lib/types.js";
import {noIndex} from "../middleware/no-index.js";
import type LoggerService from "./logger-service.js";
import type {GlobalErrorHandler} from "../lib/error-handler.js";

export type ExpressOpts = {
    port: number;
    production: boolean;
    staticPublicRoot: string;
    photosRoot: string;
    trustProxy?: number | string;
};

export type AppRouters = {
    health: Router;
    api: Router;
    admin: Router;
    previews: Router;
    seo: Router;
    public: Router;
};

const STATIC_MAX_AGE = "1h";

class ExpressService {
    #server: MaybeNull<Server> = null;
    readonly app;

    constructor(
        private readonly opts: ExpressOpts,
        private readonly log: LoggerService,
        errorHandler: GlobalErrorHandler,
        routers: AppRouters
    ) {
        this.app = express();

        if (opts.trustProxy !== undefined) this.app.set("trust proxy", opts.trustProxy);

        this.app.use(
            helmet({
                contentSecurityPolicy: {
                    directives: {
                        "script-src": ["'self'"],
                        "style-src": ["'self'", "https://fonts.googleapis.com"],
                        "font-src": ["'self'", "https://fonts.gstatic.com"],
                        "img-src": ["'self'", "data:"],
                        "upgrade-insecure-requests": opts.production ? [] : null,
                    },
                },
                hsts: opts.production ? {includeSubDomains: false} : false,
                referrerPolicy: {policy: "strict-origin-when-cross-origin"},
            })
        );
        this.app.use(compression());

        this.app.use(routers.health);
        this.app.use(this.log.makeRequestLogger());

        this.app.use(routers.previews);
        this.app.use(routers.seo);
        this.app.use("/assets/ceos", expressStatic(opts.photosRoot, {index: false, maxAge: STATIC_MAX_AGE}));
        this.app.use(expressStatic(opts.staticPublicRoot, {index: false, maxAge: STATIC_MAX_AGE}));

        this.app.use("/api", noIndex, routers.api);
        this.app.use(
            "/admin",
            noIndex,
            express.urlencoded({extended: true, limit: MAX_FORM_BYTES}),
            cookieParser(),
            routers.admin
        );
        this.app.use(routers.public);

        this.app.use((err: any, request: Request, response: Response, next: NextFunction) =>
            errorHandler(err, request, response, next)
        );
    }

    start(onError: (error: Error) => void): Promise<EmptyResult> {
        return new Promise((resolve) => {
            const server = this.app.listen(this.opts.port, (err?: Error) => {
                if (err) {
                    this.log.error(err, "failed to start server");
                    return resolve(failure(err.message));
                }
                this.#server = server;
                server.removeAllListeners("error");
                server.on("error", (serverError) => {
                    this.log.fatal(serverError, "server error");
                    onError(serverError);
                });
                this.log.info(`server listening on http://localhost:${this.opts.port}`);
                resolve(emptySuccess());
            });
        });
    }

    async teardown(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.#server) return resolve();
            this.#server.close(() => resolve());
            this.#server.closeIdleConnections();
        });
    }
}

export default ExpressService;
