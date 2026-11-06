import {join} from "node:path";
import type {AppEnv} from "./lib/env.js";
import {makeGlobalErrorHandler} from "./lib/error-handler.js";
import {PUBLIC_DIR, ROOT_DIR, databaseDir, photosDir} from "./lib/paths.js";
import {deriveKey} from "./lib/secret-box.js";
import type LoggerService from "./services/logger-service.js";
import DataService from "./services/data-service.js";
import ExpressService from "./services/express-service.js";
import ContentService from "./services/content-service.js";
import LeagueService from "./services/league-service.js";
import PageCacheService from "./services/page-cache-service.js";
import PageService from "./services/page-service.js";
import StatementService from "./services/statement-service.js";
import PreviewService from "./services/preview-service.js";
import FeedbackService from "./services/feedback-service.js";
import StatementRepository from "./repositories/statement-repository.js";
import ProposalRepository from "./repositories/proposal-repository.js";
import RunRepository from "./repositories/run-repository.js";
import SettingRepository from "./repositories/setting-repository.js";
import UserRepository from "./repositories/user-repository.js";
import ContenderRepository from "./repositories/contender-repository.js";
import RubricRepository from "./repositories/rubric-repository.js";
import AuthService from "./services/auth-service.js";
import ProposalService from "./services/proposal-service.js";
import RunService from "./services/run-service.js";
import ScoutRunnerService from "./services/scout-runner-service.js";
import {send} from "./lib/http.js";
import {createAdminAuth} from "./middleware/admin-auth.js";
import {createSameOrigin} from "./middleware/same-origin.js";
import {makeHealthRouter} from "./routers/health-router.js";
import {makeAdminRouter} from "./routers/admin-router.js";
import {loginRouter, logoutRouter} from "./routers/admin/auth.js";
import {inboxRouter} from "./routers/admin/inbox.js";
import {statementsRouter} from "./routers/admin/statements.js";
import {contendersRouter} from "./routers/admin/contenders.js";
import {rubricRouter} from "./routers/admin/rubric.js";
import {runsRouter} from "./routers/admin/runs.js";
import {settingsRouter} from "./routers/admin/settings.js";
import {notFoundRouter} from "./routers/admin/not-found.js";
import {ErrorView} from "./ui/views/admin/error.js";
import {makeApiRouter} from "./routers/api-router.js";
import {makePreviewsRouter} from "./routers/previews-router.js";
import {makePublicRouter} from "./routers/public-router.js";

const PAGE_CACHE_SIZE = 500;

export async function startApp(env: AppEnv, log: LoggerService): Promise<void> {
    const dataService = new DataService(env.DATABASE_URL, env.NODE_ENV, log);

    const statementRepo = new StatementRepository(dataService);
    const proposalRepo = new ProposalRepository(dataService);
    const runRepo = new RunRepository(dataService);
    const userRepo = new UserRepository(dataService);

    const photos = photosDir(env.DATABASE_URL);

    const content = new ContentService(
        new ContenderRepository(dataService),
        new RubricRepository(dataService),
        statementRepo,
        proposalRepo,
        photos,
        () => onStatementsChange(),
        log
    );
    const leagueService = new LeagueService(statementRepo, content);
    const pageService = new PageService(leagueService, content, new PageCacheService(PAGE_CACHE_SIZE));
    const previewService = new PreviewService(content, photos, log);
    const feedbackService = new FeedbackService(proposalRepo);

    const onStatementsChange = () => {
        leagueService.invalidate();
        previewService.clear();
    };
    const statementService = new StatementService(statementRepo, proposalRepo, content, onStatementsChange);
    const proposalService = new ProposalService(proposalRepo, statementRepo);
    const runService = new RunService(runRepo);
    const scoutRunner = new ScoutRunnerService({
        runRepo,
        settingRepo: new SettingRepository(dataService),
        log,
        production: env.NODE_ENV === "production",
        entry: join(ROOT_DIR, "dist", "scout.js"),
        root: ROOT_DIR,
        logFile: join(databaseDir(env.DATABASE_URL), "scout.log"),
        env: process.env,
        tokenKey: deriveKey(env.JWT_SECRET, "claude token"),
    });
    const authService = new AuthService(
        userRepo,
        {
            cookieName: env.JWT_COOKIE_NAME,
            secret: env.JWT_SECRET,
            bcryptRounds: env.BCRYPT_ROUNDS,
            expiryMs: env.JWT_EXPIRE_MS,
            mode: env.NODE_ENV,
        },
        log
    );

    const adminRouter = makeAdminRouter(
        createSameOrigin((_req, res) => send(res, ErrorView("Requests must come from the CMS itself."), 403)),
        loginRouter(authService),
        createAdminAuth(authService),
        [
            logoutRouter(authService),
            inboxRouter(proposalService, statementService, content),
            statementsRouter(statementRepo, statementService, proposalService, content),
            contendersRouter(content, statementRepo, proposalService, previewService),
            rubricRouter(content, proposalService),
            runsRouter(runService, proposalService, scoutRunner, content),
            settingsRouter(authService, proposalService, scoutRunner),
            notFoundRouter(proposalService),
        ]
    );

    const prepared = await dataService.prepare();
    if (!prepared.ok) {
        log.fatal("failed to open the database, is it reachable and migrated?");
        process.exit(1);
    }
    const loaded = await content.load();
    if (!loaded.ok) {
        log.fatal({reason: loaded.ctx}, "failed to load the contenders and the rubric");
        process.exit(1);
    }

    const expressService = new ExpressService(
        {
            port: env.PORT,
            production: env.NODE_ENV === "production",
            staticPublicRoot: PUBLIC_DIR,
            photosRoot: photos,
            trustProxy: env.TRUST_PROXY,
        },
        log,
        makeGlobalErrorHandler(log),
        {
            health: makeHealthRouter(dataService),
            api: makeApiRouter({feedbackService, leagueService, content}),
            admin: adminRouter,
            previews: makePreviewsRouter({
                leagueService,
                previewService,
                content,
                publicUrl: env.PUBLIC_URL,
            }),
            public: makePublicRouter({pageService, publicUrl: env.PUBLIC_URL}),
        }
    );

    let shuttingDown = false;
    const shutdown = async (signal: string, exitCode = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;
        log.info(`received ${signal}, shutting down...`);
        scoutRunner.unschedule();
        await expressService.teardown();
        await dataService.teardown();
        process.exit(exitCode);
    };

    const startResult = await expressService.start(() => shutdown("a server error", 1));
    if (!startResult.ok) {
        await dataService.teardown();
        process.exit(1);
    }

    await scoutRunner.schedule();

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
