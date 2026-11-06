import {execFileSync} from "node:child_process";
import {rmSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";

const out = resolve(process.argv[2] ?? "dist/version.json");

// npm runs this folder's scripts already, so a clone owned by another user is trusted too
function git(...args) {
    return execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

try {
    const [sha, date] = git("show", "-s", "--format=%H%n%cI", "HEAD").split("\n");
    const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
    writeFileSync(out, `${JSON.stringify({sha, date: new Date(date).toISOString(), dirty})}\n`);
    console.log(`version ${sha.slice(0, 7)}${dirty ? "-dirty" : ""}`);
} catch (error) {
    try {
        rmSync(out, {force: true});
    } catch {}
    const reason = String(error.stderr || error.message)
        .trim()
        .split("\n")[0];
    console.log(`no version from git, the admin shows dev (${reason})`);
}
