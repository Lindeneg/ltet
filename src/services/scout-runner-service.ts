import {spawn as nodeSpawn} from "node:child_process";
import {closeSync, openSync} from "node:fs";
import {readFile, readlink} from "node:fs/promises";
import {basename, resolve} from "node:path";
import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError, type DbError} from "../lib/errors.js";
import {open, seal} from "../lib/secret-box.js";
import type {MaybeNull, ValueOf} from "../lib/types.js";
import type RunRepository from "../repositories/run-repository.js";
import type SettingRepository from "../repositories/setting-repository.js";
import type LoggerService from "./logger-service.js";
import {STALE_RUN_MS} from "./scout-service.js";

export const SCOUT_TIME_KEY = "scoutTime";
export const DEFAULT_SCOUT_TIME = "06:00";
export const CLAUDE_TOKEN_KEY = "claudeToken";
const TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const DAY_MS = 86_400_000;
const STOPPED = "Stopped.";
const NOT_STARTED = "The scout failed to start.";
const ENDED = "The scout ended without finishing.";
const STOP_WAIT_MS = 5000;
const STOP_POLL_MS = 100;

export const StartError = {
    BUSY: "busy",
    NOT_STARTED: "not_started",
} as const;

export type StartError = ValueOf<typeof StartError>;

export type StartOpts = {startedBy: string; since?: string; dryRun: boolean};

export type TokenStatus =
    {source: "cms"; setAt: Date; unreadable: false} | {source: "env" | "none"; unreadable: boolean};

type StoredToken = {token: MaybeNull<string>; setAt: MaybeNull<Date>; unreadable: boolean};

export type ProcessInfo = {argv: string[]; cwd: string};

export async function processInfo(pid: number): Promise<MaybeNull<ProcessInfo>> {
    try {
        const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
        return {argv: cmdline.split("\0").filter(Boolean), cwd: await readlink(`/proc/${pid}/cwd`)};
    } catch {
        return null;
    }
}

export function isScout(info: MaybeNull<ProcessInfo>, entry: string, root: string): boolean {
    if (!info) return false;
    const [bin, script] = info.argv;
    if (!bin || !script || !basename(bin).startsWith("node")) return false;
    return resolve(info.cwd) === resolve(root) && resolve(info.cwd, script) === resolve(entry);
}

export function nextAt(time: string, after: number): number {
    const [hours, minutes] = time.split(":").map(Number);
    const date = new Date(after);
    const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes);
    return today > after ? today : today + DAY_MS;
}

export type ScoutRunnerDeps = {
    runRepo: RunRepository;
    settingRepo: SettingRepository;
    log: LoggerService;
    production: boolean;
    entry: string;
    root: string;
    logFile: string;
    env: NodeJS.ProcessEnv;
    tokenKey: Buffer;
    spawn?: typeof nodeSpawn;
    processInfo?: (pid: number) => Promise<MaybeNull<ProcessInfo>>;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    stopWaitMs?: number;
};

function parseStored(value: string): {sealed?: unknown; setAt?: unknown} {
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

const withLine = (log: MaybeNull<string>, line: string) => (log ? `${log}\n${line}` : line);

class ScoutRunnerService {
    #timer: MaybeNull<NodeJS.Timeout> = null;
    #nextAt: MaybeNull<number> = null;

    constructor(private readonly deps: ScoutRunnerDeps) {}

    async start({startedBy, since, dryRun}: StartOpts): AsyncResult<number, StartError | DbError> {
        const {runRepo, log, entry, root, logFile, spawn = nodeSpawn} = this.deps;
        const cleared = await this.#clearDead();
        if (!cleared.ok) return cleared;
        const claimed = await runRepo.claim({startedBy, dryRun, staleBefore: this.#staleBefore()});
        if (!claimed.ok) return claimed;
        if (claimed.data === null) return failure(StartError.BUSY);
        const id = claimed.data;
        const env = await this.#childEnv();

        const args = [entry, "--run", String(id)];
        if (since) args.push("--since", since);
        if (dryRun) args.push("--dry-run");
        let fd: MaybeNull<number> = null;
        try {
            fd = openSync(logFile, "a");
            const child = spawn(process.execPath, args, {
                cwd: root,
                env,
                detached: true,
                stdio: ["ignore", fd, fd],
            });
            child.on("error", (error) => log.error(error, `scout run ${id} failed`));
            child.unref();
            if (child.pid === undefined) throw new Error("the scout got no pid");
            const saved = await runRepo.setPid(id, child.pid);
            if (!saved.ok) throw new Error(`saving the pid failed with ${saved.ctx}`);
            return success(id);
        } catch (error) {
            log.error(error, `scout run ${id} failed to start`);
            await runRepo.finish(id, {status: "failed", summary: null, log: NOT_STARTED});
            return failure(StartError.NOT_STARTED);
        } finally {
            if (fd !== null) closeSync(fd);
        }
    }

    async stop(id: number): AsyncResult<void, DbError> {
        const {runRepo, processInfo: info = processInfo, kill = process.kill, entry, root} = this.deps;
        const run = await runRepo.get(id);
        if (!run.ok) return run;
        if (!run.data) return failure(AppError.NOT_FOUND);
        const {status, pid, summary, log} = run.data;
        if (status !== "running") return success(undefined);
        if (pid === null || !isScout(await info(pid), entry, root)) {
            return runRepo.finish(id, {status: "stopped", summary, log: withLine(log, STOPPED)});
        }
        try {
            kill(pid, "SIGTERM");
        } catch {}
        if (!(await this.#gone(pid))) return success(undefined);
        const after = await runRepo.get(id);
        if (!after.ok) return after;
        if (after.data?.status !== "running") return success(undefined);
        return runRepo.finish(id, {
            status: "stopped",
            summary: after.data.summary,
            log: withLine(after.data.log, STOPPED),
        });
    }

    running(): ReturnType<RunRepository["running"]> {
        return this.deps.runRepo.running(this.#staleBefore());
    }

    async scoutTime(): AsyncResult<string, DbError> {
        const time = await this.deps.settingRepo.get(SCOUT_TIME_KEY);
        if (!time.ok) return time;
        return success(time.data ?? DEFAULT_SCOUT_TIME);
    }

    async setScoutTime(time: string): AsyncResult<void, DbError> {
        const saved = await this.deps.settingRepo.set(SCOUT_TIME_KEY, time);
        if (!saved.ok) return saved;
        await this.schedule();
        return saved;
    }

    async claudeToken(): AsyncResult<TokenStatus, DbError> {
        const stored = await this.#storedToken();
        if (!stored.ok) return stored;
        const {token, setAt, unreadable} = stored.data;
        if (token && setAt) return success({source: "cms", setAt, unreadable: false});
        return success({source: this.deps.env[TOKEN_ENV] ? "env" : "none", unreadable});
    }

    setClaudeToken(token: string): AsyncResult<void, DbError> {
        const value = JSON.stringify({sealed: seal(this.deps.tokenKey, token), setAt: new Date().toISOString()});
        return this.deps.settingRepo.set(CLAUDE_TOKEN_KEY, value);
    }

    removeClaudeToken(): AsyncResult<void, DbError> {
        return this.deps.settingRepo.remove(CLAUDE_TOKEN_KEY);
    }

    nextRun(): MaybeNull<Date> {
        return this.#nextAt === null ? null : new Date(this.#nextAt);
    }

    async schedule(after = Date.now()): Promise<void> {
        this.unschedule();
        if (!this.deps.production) return;
        const time = await this.scoutTime();
        this.unschedule();
        if (!time.ok) {
            this.deps.log.error({reason: time.ctx}, "failed to schedule the scout");
            return;
        }
        const at = nextAt(time.data, Math.max(after, Date.now()));
        this.#nextAt = at;
        this.#timer = setTimeout(() => void this.#fire(at), at - Date.now());
    }

    unschedule(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        this.#nextAt = null;
    }

    async #fire(at: number): Promise<void> {
        const {log} = this.deps;
        const started = await this.start({startedBy: "schedule", dryRun: false});
        if (started.ok) {
            log.info(`scout started by the schedule, run ${started.data}`);
        } else if (started.ctx === StartError.BUSY) {
            const running = await this.running();
            log.info(`scout skipped, run ${running.ok ? running.data?.id : "?"} is still going`);
        } else {
            log.error({reason: started.ctx}, "the schedule failed to start the scout");
        }
        await this.schedule(at);
    }

    async #isOurs(pid: number): Promise<boolean> {
        const {processInfo: info = processInfo, entry, root} = this.deps;
        return isScout(await info(pid), entry, root);
    }

    // a scout killed before its handler is in place never marks its own run
    async #gone(pid: number): Promise<boolean> {
        const deadline = Date.now() + (this.deps.stopWaitMs ?? STOP_WAIT_MS);
        while (await this.#isOurs(pid)) {
            if (Date.now() >= deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
        }
        return true;
    }

    async #clearDead(): AsyncResult<void, DbError> {
        const {runRepo} = this.deps;
        const running = await this.running();
        if (!running.ok) return running;
        const pid = running.data?.pid ?? null;
        if (running.data === null || pid === null || (await this.#isOurs(pid))) return success(undefined);
        const run = await runRepo.get(running.data.id);
        if (!run.ok) return run;
        if (run.data?.status !== "running") return success(undefined);
        return runRepo.finish(run.data.id, {
            status: "failed",
            summary: run.data.summary,
            log: withLine(run.data.log, ENDED),
        });
    }

    #staleBefore(): Date {
        return new Date(Date.now() - STALE_RUN_MS);
    }

    async #storedToken(): AsyncResult<StoredToken, DbError> {
        const value = await this.deps.settingRepo.get(CLAUDE_TOKEN_KEY);
        if (!value.ok) return value;
        if (value.data === null) return success({token: null, setAt: null, unreadable: false});
        const {sealed, setAt} = parseStored(value.data);
        const token = typeof sealed === "string" ? open(this.deps.tokenKey, sealed) : null;
        const date = typeof setAt === "string" ? new Date(setAt) : null;
        if (token && date && !Number.isNaN(date.getTime())) return success({token, setAt: date, unreadable: false});
        this.deps.log.warn("the saved claude token can't be read, so the scout gets the server's own");
        return success({token: null, setAt: null, unreadable: true});
    }

    async #childEnv(): Promise<NodeJS.ProcessEnv> {
        const {SUPER_USER: _user, JWT_SECRET: _secret, ...env} = this.deps.env;
        const stored = await this.#storedToken();
        if (!stored.ok) this.deps.log.error({reason: stored.ctx}, "failed to read the claude token");
        else if (stored.data.token) env[TOKEN_ENV] = stored.data.token;
        return env;
    }
}

export default ScoutRunnerService;
