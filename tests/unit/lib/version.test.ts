import {execFileSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {parseVersion, readVersion} from "../../../src/lib/version.js";
import {versionLine} from "../../../src/ui/components/admin-layout.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TOOL = fileURLToPath(new URL("../../../tools/version.mjs", import.meta.url));

describe("parseVersion", () => {
    it("reads a version written by the build", () => {
        expect(parseVersion(JSON.stringify({sha: SHA, date: "2026-11-06T14:32:05.000Z", dirty: false}))).toEqual({
            sha: SHA,
            date: "2026-11-06T14:32:05.000Z",
            dirty: false,
        });
    });

    it("refuses broken json, a short sha, a bad date or a missing field", () => {
        expect(parseVersion("{")).toBeNull();
        expect(
            parseVersion(JSON.stringify({sha: "0123456", date: "2026-11-06T14:32:05.000Z", dirty: false}))
        ).toBeNull();
        expect(parseVersion(JSON.stringify({sha: SHA, date: "yesterday", dirty: false}))).toBeNull();
        expect(parseVersion(JSON.stringify({sha: SHA, date: "2026-11-06T14:32:05.000Z"}))).toBeNull();
    });
});

describe("readVersion", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ltet-version-"));
    });
    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    it("reads the file, and has none when it is missing or malformed", async () => {
        const file = join(dir, "version.json");
        expect(readVersion(file)).toBeNull();
        await writeFile(file, "not json");
        expect(readVersion(file)).toBeNull();
        await writeFile(file, JSON.stringify({sha: SHA, date: "2026-11-06T14:32:05.000Z", dirty: true}));
        expect(readVersion(file)?.dirty).toBe(true);
    });
});

describe("the build's version step", () => {
    let dir: string;
    const out = () => join(dir, "version.json");
    const run = (env: NodeJS.ProcessEnv = process.env) =>
        execFileSync(process.execPath, [TOOL, out()], {
            cwd: dir,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
    const git = (...args: string[]) => execFileSync("git", args, {cwd: dir, stdio: "ignore"});

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ltet-build-"));
    });
    afterEach(async () => {
        await rm(dir, {recursive: true, force: true});
    });

    function commit() {
        git("init", "-q");
        git("add", ".");
        execFileSync(
            "git",
            [
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@example.com",
                "commit",
                "-q",
                "-m",
                "c",
                "--date=2026-11-06T15:32:05+01:00",
            ],
            {cwd: dir, stdio: "ignore", env: {...process.env, GIT_COMMITTER_DATE: "2026-11-06T15:32:05+01:00"}}
        );
    }

    it("writes the commit's sha and its date in utc", async () => {
        await writeFile(join(dir, "a.txt"), "a");
        commit();
        run();
        const version = parseVersion(await readFile(out(), "utf8"));
        expect(version?.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(version?.date).toBe("2026-11-06T14:32:05.000Z");
        expect(version?.dirty).toBe(false);
    });

    it("marks a build from changed tracked files as dirty, and ignores untracked ones", async () => {
        await writeFile(join(dir, "a.txt"), "a");
        commit();
        await writeFile(join(dir, "new.txt"), "n");
        run();
        expect(parseVersion(await readFile(out(), "utf8"))?.dirty).toBe(false);
        await writeFile(join(dir, "a.txt"), "b");
        run();
        expect(parseVersion(await readFile(out(), "utf8"))?.dirty).toBe(true);
    });

    it("never fails the build when the old file can't be removed", async () => {
        await mkdir(join(out(), "inside"), {recursive: true});
        expect(() => run({...process.env, GIT_CEILING_DIRECTORIES: tmpdir()})).not.toThrow();
    });

    it("removes a stale version outside a repository, before the first commit and without git", async () => {
        await writeFile(out(), "stale");
        run({...process.env, GIT_CEILING_DIRECTORIES: tmpdir()});
        expect(readVersion(out())).toBeNull();
        git("init", "-q");
        await writeFile(out(), "stale");
        expect(run()).toMatch(/^no version from git, the admin shows dev \(fatal: .+\)\n$/);
        expect(readVersion(out())).toBeNull();
        await writeFile(out(), "stale");
        run({...process.env, PATH: ""});
        expect(readVersion(out())).toBeNull();
    });
});

describe("versionLine", () => {
    it("links the short sha to its commit and shows the date in utc", () => {
        expect(versionLine({sha: SHA, date: "2026-11-06T14:32:05.000Z", dirty: false})).toBe(
            `Version <a href="https://github.com/Lindeneg/ltet/commit/${SHA}">0123456</a> · 2026-11-06 14:32 UTC`
        );
    });

    it("says dirty and dev", () => {
        expect(versionLine({sha: SHA, date: "2026-11-06T14:32:05.000Z", dirty: true})).toContain("</a>-dirty · ");
        expect(versionLine(null)).toBe("Version dev");
    });
});
