import {EventEmitter} from "node:events";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import {deriveKey, seal} from "../../../src/lib/secret-box.js";
import ScoutRunnerService, {
    CLAUDE_TOKEN_KEY,
    StartError,
    isScout,
    processInfo as readProcess,
    nextAt,
    type ScoutRunnerDeps,
} from "../../../src/services/scout-runner-service.js";
import type RunRepository from "../../../src/repositories/run-repository.js";
import type SettingRepository from "../../../src/repositories/setting-repository.js";
import {fake, fakeLog, makeRun} from "../helpers.js";

const ROOT = "/srv/ltet";
const ENTRY = "/srv/ltet/dist/scout.js";
const KEY = deriveKey("a secret of at least thirty two characters", "claude token");
const TOKEN = "sk-ant-oat01-the-cms-token";

describe("nextAt", () => {
    const at = (iso: string) => Date.parse(iso);

    it("is today when the time is still to come, else tomorrow", () => {
        expect(nextAt("06:00", at("2026-11-01T05:59:00Z"))).toBe(at("2026-11-01T06:00:00Z"));
        expect(nextAt("06:00", at("2026-11-01T06:00:00Z"))).toBe(at("2026-11-02T06:00:00Z"));
        expect(nextAt("23:45", at("2026-12-31T23:50:00Z"))).toBe(at("2027-01-01T23:45:00Z"));
    });
});

describe("isScout", () => {
    it("knows our scout by its script and folder, whether the path is relative or not", () => {
        expect(isScout({argv: ["node", "dist/scout.js", "--run", "3"], cwd: ROOT}, ENTRY, ROOT)).toBe(true);
        expect(isScout({argv: ["/usr/bin/node", ENTRY], cwd: ROOT}, ENTRY, `${ROOT}/`)).toBe(true);
    });

    it("refuses anything else", () => {
        expect(isScout(null, ENTRY, ROOT)).toBe(false);
        expect(isScout({argv: ["node", "dist/index.js"], cwd: ROOT}, ENTRY, ROOT)).toBe(false);
        expect(isScout({argv: ["node", "dist/scout.js"], cwd: "/srv/other"}, ENTRY, ROOT)).toBe(false);
        expect(isScout({argv: ["python", ENTRY], cwd: ROOT}, ENTRY, ROOT)).toBe(false);
        expect(isScout({argv: ["node"], cwd: ROOT}, ENTRY, ROOT)).toBe(false);
    });
});

describe("ScoutRunnerService", () => {
    let runRepo: {claim: Mock; running: Mock; setPid: Mock; finish: Mock; get: Mock};
    let settingRepo: {get: Mock; set: Mock; remove: Mock};
    let spawn: Mock;
    let child: EventEmitter & {pid?: number; unref: Mock};
    let processInfo: Mock;
    let kill: Mock;
    let log: ReturnType<typeof fakeLog>;
    let logFile: string;

    function runner(overrides: Partial<ScoutRunnerDeps> = {}) {
        return new ScoutRunnerService({
            runRepo: fake<RunRepository>(runRepo),
            settingRepo: fake<SettingRepository>(settingRepo),
            log,
            production: true,
            entry: ENTRY,
            root: ROOT,
            logFile,
            env: {HOME: "/home/x", SUPER_USER: "a,b,c,d", JWT_SECRET: "s", CLAUDE_CODE_OAUTH_TOKEN: "t"},
            tokenKey: KEY,
            spawn: spawn as never,
            processInfo,
            kill,
            ...overrides,
        });
    }

    beforeEach(async () => {
        runRepo = {
            claim: vi.fn().mockResolvedValue(success(5)),
            running: vi.fn().mockResolvedValue(success(makeRun({id: 4, status: "running"}))),
            setPid: vi.fn().mockResolvedValue(success(undefined)),
            finish: vi.fn().mockResolvedValue(success(undefined)),
            get: vi.fn().mockResolvedValue(success(makeRun({id: 5, status: "running", pid: 321, log: "a line"}))),
        };
        settingRepo = {
            get: vi.fn().mockResolvedValue(success(null)),
            set: vi.fn().mockResolvedValue(success(undefined)),
            remove: vi.fn().mockResolvedValue(success(undefined)),
        };
        child = Object.assign(new EventEmitter(), {pid: 321, unref: vi.fn()});
        spawn = vi.fn(() => child);
        processInfo = vi.fn().mockResolvedValue({argv: ["node", ENTRY, "--run", "5"], cwd: ROOT});
        kill = vi.fn();
        log = fakeLog();
        logFile = join(await mkdtemp(join(tmpdir(), "ltet-runner-")), "scout.log");
    });

    afterEach(() => vi.useRealTimers());

    describe("start", () => {
        it("claims a run and starts the scout on it, detached, without the server's secrets", async () => {
            expect(await runner().start({startedBy: "admin@example.com", since: "2026-10-01", dryRun: true})).toEqual(
                success(5)
            );

            expect(runRepo.claim.mock.calls[0][0]).toMatchObject({startedBy: "admin@example.com", dryRun: true});
            const [bin, args, opts] = spawn.mock.calls[0] as unknown as [
                string,
                string[],
                {cwd: string; env: object; detached: boolean},
            ];
            expect(bin).toBe(process.execPath);
            expect(args).toEqual([ENTRY, "--run", "5", "--since", "2026-10-01", "--dry-run"]);
            expect(opts.cwd).toBe(ROOT);
            expect(opts.detached).toBe(true);
            expect(opts.env).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: "t"});
            expect(child.unref).toHaveBeenCalled();
            expect(runRepo.setPid).toHaveBeenCalledWith(5, 321);
        });

        it("leaves out since and dry run when not asked for", async () => {
            await runner().start({startedBy: "schedule", dryRun: false});

            expect(spawn.mock.calls[0][1]).toEqual([ENTRY, "--run", "5"]);
        });

        it("refuses while a run is going", async () => {
            runRepo.claim.mockResolvedValue(success(null));

            expect(await runner().start({startedBy: "schedule", dryRun: false})).toEqual(failure(StartError.BUSY));
            expect(spawn).not.toHaveBeenCalled();
        });

        it("fails the run when the scout can't be started", async () => {
            spawn.mockImplementation(() => {
                throw new Error("spawn EACCES");
            });

            expect(await runner().start({startedBy: "schedule", dryRun: false})).toEqual(
                failure(StartError.NOT_STARTED)
            );
            expect(runRepo.finish).toHaveBeenCalledWith(5, {
                status: "failed",
                summary: null,
                log: "The scout failed to start.",
            });
        });
    });

    describe("the claude token", () => {
        const stored = (key = KEY, setAt = "2026-11-06T10:00:00.000Z") =>
            JSON.stringify({sealed: seal(key, TOKEN), setAt});
        const childEnv = () => (spawn.mock.calls.at(-1) as unknown as [string, string[], {env: object}])[2].env;
        const logged = () => JSON.stringify(Object.values(log).map((fn) => (fn as Mock).mock.calls));

        it("saves the token sealed, never in plain text", async () => {
            expect(await runner().setClaudeToken(TOKEN)).toEqual(success(undefined));

            const [key, value] = settingRepo.set.mock.calls[0];
            expect(key).toBe(CLAUDE_TOKEN_KEY);
            expect(value).not.toContain(TOKEN);
            expect(JSON.parse(value)).toEqual({sealed: expect.any(String), setAt: expect.any(String)});
        });

        it("seals the same token differently each time", async () => {
            await runner().setClaudeToken(TOKEN);
            await runner().setClaudeToken(TOKEN);

            const [first, second] = settingRepo.set.mock.calls.map(([, value]) => JSON.parse(value).sealed);
            expect(first).not.toBe(second);
        });

        it("gives the scout the cms token over the server's, without the server's secrets", async () => {
            settingRepo.get.mockResolvedValue(success(stored()));

            await runner().start({startedBy: "schedule", dryRun: false});

            expect(settingRepo.get).toHaveBeenCalledWith(CLAUDE_TOKEN_KEY);
            expect(childEnv()).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: TOKEN});
            expect(logged()).not.toContain(TOKEN);
        });

        it("gives the scout no token when neither the cms nor the server has one", async () => {
            await runner({env: {HOME: "/home/x"}}).start({startedBy: "schedule", dryRun: false});

            expect(childEnv()).toEqual({HOME: "/home/x"});
        });

        it("keeps a going run on the token it started with, and gives the next run the new one", async () => {
            const service = runner();
            await service.start({startedBy: "schedule", dryRun: false});
            const first = childEnv();
            settingRepo.get.mockResolvedValue(success(stored()));

            await service.start({startedBy: "schedule", dryRun: false});

            expect(first).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: "t"});
            expect(childEnv()).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: TOKEN});
        });

        it("falls back to the server's token and warns when the saved one can't be read", async () => {
            const rotated = deriveKey("another secret of at least thirty two chars", "claude token");
            for (const value of [stored(rotated), "not json", JSON.stringify({sealed: "AAAA"}), stored(KEY, "never")]) {
                settingRepo.get.mockResolvedValue(success(value));
                log = fakeLog();

                await runner().start({startedBy: "schedule", dryRun: false});

                expect(childEnv(), value).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: "t"});
                expect(log.warn, value).toHaveBeenCalledWith(
                    "the saved claude token can't be read, so the scout gets the server's own"
                );
                expect(logged()).not.toContain(TOKEN);
            }
        });

        it("falls back to the server's token when the setting can't be read", async () => {
            settingRepo.get.mockResolvedValue(failure(AppError.DB_ERROR));

            expect(await runner().start({startedBy: "schedule", dryRun: false})).toEqual(success(5));

            expect(childEnv()).toEqual({HOME: "/home/x", CLAUDE_CODE_OAUTH_TOKEN: "t"});
            expect(log.error).toHaveBeenCalled();
        });

        it("says where the token comes from", async () => {
            settingRepo.get.mockResolvedValue(success(stored()));
            expect(await runner().claudeToken()).toEqual(
                success({source: "cms", setAt: new Date("2026-11-06T10:00:00.000Z"), unreadable: false})
            );

            settingRepo.get.mockResolvedValue(success(null));
            expect(await runner().claudeToken()).toEqual(success({source: "env", unreadable: false}));
            expect(await runner({env: {}}).claudeToken()).toEqual(success({source: "none", unreadable: false}));

            settingRepo.get.mockResolvedValue(success(stored(deriveKey("x".repeat(32), "claude token"))));
            expect(await runner().claudeToken()).toEqual(success({source: "env", unreadable: true}));
            expect(await runner({env: {}}).claudeToken()).toEqual(success({source: "none", unreadable: true}));
        });

        it("removes the saved token", async () => {
            expect(await runner().removeClaudeToken()).toEqual(success(undefined));

            expect(settingRepo.remove).toHaveBeenCalledWith(CLAUDE_TOKEN_KEY);
        });
    });

    describe("a run whose scout died", () => {
        it("is failed before a new run starts, so it doesn't hold the lock", async () => {
            runRepo.running.mockResolvedValue(success(makeRun({id: 4, status: "running", pid: 99})));
            runRepo.get.mockResolvedValue(success(makeRun({id: 4, status: "running", pid: 99, log: "a line"})));
            processInfo.mockResolvedValue(null);

            expect(await runner().start({startedBy: "schedule", dryRun: false})).toEqual(success(5));

            expect(runRepo.finish).toHaveBeenCalledWith(4, {
                status: "failed",
                summary: makeRun().summary,
                log: "a line\nThe scout ended without finishing.",
            });
            expect(runRepo.finish.mock.invocationCallOrder[0]).toBeLessThan(runRepo.claim.mock.invocationCallOrder[0]);
        });

        it("is left alone while its scout lives or before its pid is saved", async () => {
            runRepo.running.mockResolvedValue(success(makeRun({id: 4, status: "running", pid: 321})));
            await runner().start({startedBy: "schedule", dryRun: false});
            runRepo.running.mockResolvedValue(success(makeRun({id: 4, status: "running", pid: null})));
            await runner().start({startedBy: "schedule", dryRun: false});

            expect(runRepo.finish).not.toHaveBeenCalled();
        });
    });

    describe("stop", () => {
        const exitsOnKill = () => {
            kill.mockImplementation(() => processInfo.mockResolvedValue(null));
        };

        it("ends our scout by its pid and leaves the run it marked itself", async () => {
            exitsOnKill();
            runRepo.get
                .mockResolvedValueOnce(success(makeRun({id: 5, status: "running", pid: 321, log: "a line"})))
                .mockResolvedValueOnce(success(makeRun({id: 5, status: "stopped", pid: 321})));

            expect(await runner().stop(5)).toEqual(success(undefined));

            expect(processInfo).toHaveBeenCalledWith(321);
            expect(kill).toHaveBeenCalledWith(321, "SIGTERM");
            expect(runRepo.finish).not.toHaveBeenCalled();
        });

        it("marks the run stopped when the scout dies without marking it", async () => {
            exitsOnKill();
            runRepo.get
                .mockResolvedValueOnce(success(makeRun({id: 5, status: "running", pid: 321, log: null})))
                .mockResolvedValueOnce(success(makeRun({id: 5, status: "running", pid: 321, log: "a line"})));

            await runner().stop(5);

            expect(runRepo.finish).toHaveBeenCalledWith(5, {
                status: "stopped",
                summary: makeRun().summary,
                log: "a line\nStopped.",
            });
        });

        it("leaves a scout still stopping when the wait runs out", async () => {
            expect(await runner({stopWaitMs: 50}).stop(5)).toEqual(success(undefined));

            expect(kill).toHaveBeenCalledWith(321, "SIGTERM");
            expect(runRepo.finish).not.toHaveBeenCalled();
        });

        it("ends nothing when the pid is no longer our scout, and marks the run stopped", async () => {
            processInfo.mockResolvedValue({argv: ["node", "/srv/else/app.js"], cwd: "/srv/else"});

            await runner().stop(5);

            expect(kill).not.toHaveBeenCalled();
            expect(runRepo.finish).toHaveBeenCalledWith(5, {
                status: "stopped",
                summary: makeRun().summary,
                log: "a line\nStopped.",
            });
        });

        it("marks a run with no pid stopped", async () => {
            runRepo.get.mockResolvedValue(success(makeRun({id: 5, status: "running", pid: null, log: null})));

            await runner().stop(5);

            expect(processInfo).not.toHaveBeenCalled();
            expect(runRepo.finish.mock.calls[0][1].log).toBe("Stopped.");
        });

        it("marks the run stopped when the process is already gone", async () => {
            kill.mockImplementation(() => {
                processInfo.mockResolvedValue(null);
                throw new Error("ESRCH");
            });

            await runner().stop(5);

            expect(runRepo.finish.mock.calls[0][1].status).toBe("stopped");
        });

        it("does nothing to a finished run and reports a missing one", async () => {
            runRepo.get.mockResolvedValue(success(makeRun({status: "ok"})));
            expect(await runner().stop(1)).toEqual(success(undefined));
            expect(kill).not.toHaveBeenCalled();
            expect(runRepo.finish).not.toHaveBeenCalled();

            runRepo.get.mockResolvedValue(success(null));
            expect(await runner().stop(9)).toEqual(failure(AppError.NOT_FOUND));
        });
    });

    describe("schedule", () => {
        it("schedules nothing outside production", async () => {
            const service = runner({production: false});

            await service.schedule();

            expect(service.nextRun()).toBeNull();
            expect(settingRepo.get).not.toHaveBeenCalled();
        });

        it("runs at 06:00 UTC by default, skipping a time already past, and runs again the next day", async () => {
            vi.useFakeTimers({now: Date.parse("2026-11-01T07:00:00Z")});
            const service = runner();

            await service.schedule();
            expect(service.nextRun()).toEqual(new Date("2026-11-02T06:00:00Z"));

            await vi.advanceTimersByTimeAsync(23 * 3_600_000);
            expect(spawn).toHaveBeenCalledTimes(1);
            expect(runRepo.claim.mock.calls[0][0]).toMatchObject({startedBy: "schedule", dryRun: false});
            expect(log.info).toHaveBeenCalledWith("scout started by the schedule, run 5");
            expect(service.nextRun()).toEqual(new Date("2026-11-03T06:00:00Z"));
            service.unschedule();
        });

        it("skips the time while a run is going", async () => {
            vi.useFakeTimers({now: Date.parse("2026-11-01T05:00:00Z")});
            runRepo.claim.mockResolvedValue(success(null));
            const service = runner();

            await service.schedule();
            await vi.advanceTimersByTimeAsync(3_600_000);

            expect(spawn).not.toHaveBeenCalled();
            expect(log.info).toHaveBeenCalledWith("scout skipped, run 4 is still going");
            expect(service.nextRun()).toEqual(new Date("2026-11-02T06:00:00Z"));
            service.unschedule();
        });

        it("follows a new time as soon as it is saved", async () => {
            vi.useFakeTimers({now: Date.parse("2026-11-01T05:00:00Z")});
            const service = runner();
            await service.schedule();
            settingRepo.get.mockResolvedValue(success("05:30"));

            expect(await service.setScoutTime("05:30")).toEqual(success(undefined));

            expect(settingRepo.set).toHaveBeenCalledWith("scoutTime", "05:30");
            expect(service.nextRun()).toEqual(new Date("2026-11-01T05:30:00Z"));
            service.unschedule();
            expect(service.nextRun()).toBeNull();
        });

        it("reads the saved time, or 06:00 when none is saved", async () => {
            expect(await runner().scoutTime()).toEqual(success("06:00"));
            settingRepo.get.mockResolvedValue(success("21:15"));
            expect(await runner().scoutTime()).toEqual(success("21:15"));
        });
    });

    describe.skipIf(process.platform !== "linux")("with a real scout process", () => {
        it("marks a run stopped at 0 ms, before the scout has its stop handler", async () => {
            const dir = await mkdtemp(join(tmpdir(), "ltet-stop-"));
            const entry = join(dir, "scout.js");
            await writeFile(
                entry,
                `setTimeout(() => process.on("SIGTERM", () => process.exit(0)), 300); setInterval(() => {}, 1000);`
            );
            const row = {...makeRun({id: 1, status: "running", pid: null, log: null})};
            const repo = {
                claim: vi.fn().mockResolvedValue(success(1)),
                running: vi.fn().mockResolvedValue(success(null)),
                setPid: vi.fn(async (_id: number, pid: number) => {
                    row.pid = pid;
                    return success(undefined);
                }),
                get: vi.fn(async () => success({...row})),
                finish: vi.fn(async (_id: number, data: {status: typeof row.status; log: string}) => {
                    if (row.status === "running") Object.assign(row, data);
                    return success(undefined);
                }),
            };
            const service = new ScoutRunnerService({
                runRepo: fake<RunRepository>(repo),
                settingRepo: fake<SettingRepository>(settingRepo),
                log,
                production: false,
                entry,
                root: dir,
                logFile: join(dir, "scout.log"),
                env: {},
            });

            expect(await service.start({startedBy: "admin@example.com", dryRun: true})).toEqual(success(1));
            const pid = row.pid!;
            expect(await service.stop(1)).toEqual(success(undefined));

            expect(row.status).toBe("stopped");
            expect(row.log).toBe("Stopped.");
            expect(isScout(await readProcess(pid), entry, dir)).toBe(false);
        });
    });
});
