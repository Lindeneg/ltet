import {join} from "node:path";
import {loadScoutEnv} from "./lib/env.js";
import {databaseDir, photosDir, PROMPTS_DIR} from "./lib/paths.js";
import LoggerService from "./services/logger-service.js";
import DataService from "./services/data-service.js";
import ContentService from "./services/content-service.js";
import ClaudeService from "./services/claude-service.js";
import ScoutService from "./services/scout-service.js";
import StatementRepository from "./repositories/statement-repository.js";
import ProposalRepository from "./repositories/proposal-repository.js";
import RunRepository from "./repositories/run-repository.js";
import ContenderRepository from "./repositories/contender-repository.js";
import RubricRepository from "./repositories/rubric-repository.js";

const stop = new AbortController();
process.on("SIGTERM", () => stop.abort());

const args = process.argv.slice(2);
const option = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

const env = loadScoutEnv();
const log = new LoggerService("production");
const dataService = new DataService(env.DATABASE_URL, "production", log);
const statementRepo = new StatementRepository(dataService);
const proposalRepo = new ProposalRepository(dataService);
const contentService = new ContentService(
    new ContenderRepository(dataService),
    new RubricRepository(dataService),
    statementRepo,
    proposalRepo,
    photosDir(env.DATABASE_URL),
    () => {},
    log
);

const loaded = await contentService.load();
if (!loaded.ok) {
    console.error(`Failed to load the contenders and the rubric: ${loaded.ctx}`);
    await dataService.teardown();
    process.exit(1);
}
const content = loaded.data;

const scout = new ScoutService({
    statementRepo,
    proposalRepo,
    runRepo: new RunRepository(dataService),
    claude: new ClaudeService(env.CLAUDE_BIN),
    content,
    model: env.SCOUT_MODEL,
    workDir: join(databaseDir(env.DATABASE_URL), "scout-work"),
    promptsDir: PROMPTS_DIR,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
});

const runId = option("--run");
if (runId !== undefined && !/^\d+$/.test(runId)) {
    console.error("--run takes a run number.");
    await dataService.teardown();
    process.exit(1);
}
const ok = await scout.run({
    since: option("--since"),
    dryRun: args.includes("--dry-run"),
    runId: runId === undefined ? undefined : Number(runId),
    signal: stop.signal,
});
await dataService.teardown();
// a stopped claude may leave a child holding the pipes open, which would keep this process alive
if (stop.signal.aborted) process.exit(1);
process.exitCode = ok ? 0 : 1;
