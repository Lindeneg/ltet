import {EventEmitter} from "node:events";
import {describe, expect, it, vi} from "vitest";
import ClaudeService, {claudeArgs} from "../../../src/services/claude-service.js";

type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {end: (s: string) => void};
    kill: () => void;
};

function fakeSpawn(answer: (prompt: string) => {stdout?: string; stderr?: string; code?: number} | null) {
    return vi.fn(() => {
        const child = new EventEmitter() as FakeChild;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        child.stdin = {
            end: (prompt: string) => {
                const result = answer(prompt);
                if (!result) return;
                setImmediate(() => {
                    if (result.stdout) child.stdout.emit("data", result.stdout);
                    if (result.stderr) child.stderr.emit("data", result.stderr);
                    child.emit("close", result.code ?? 0);
                });
            },
        };
        return child;
    });
}

const request = {prompt: "find things", schema: {type: "object"}, model: "opus", timeoutMs: 60_000, cwd: "/work"};
const success = (output: unknown) =>
    JSON.stringify({subtype: "success", is_error: false, structured_output: output, total_cost_usd: 0.5, num_turns: 4});

describe("claudeArgs", () => {
    it("asks for json against the schema with only the tools named", () => {
        expect(claudeArgs({schema: {type: "object"}, model: "opus", tools: ["WebSearch", "WebFetch"]})).toEqual([
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            '{"type":"object"}',
            "--model",
            "opus",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--restricted",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "WebSearch,WebFetch",
            "--allowedTools",
            "WebSearch",
            "WebFetch",
        ]);
    });

    it("gives no tools at all when none are named", () => {
        const args = claudeArgs({schema: {}, model: "opus"});

        expect(args.slice(-2)).toEqual(["--tools", ""]);
        expect(args).not.toContain("--allowedTools");
    });
});

describe("ClaudeService", () => {
    it("runs the binary in the work folder without the api key and resolves to the answer", async () => {
        let prompt = "";
        const spawn = fakeSpawn((p) => {
            prompt = p;
            return {stdout: success({leads: []})};
        });
        const claude = new ClaudeService("/bin/claude", spawn as never, {ANTHROPIC_API_KEY: "secret", HOME: "/home/x"});

        const answer = await claude.run(request);

        expect(answer).toEqual({output: {leads: []}, costUsd: 0.5, turns: 4});
        expect(prompt).toBe("find things");
        const [bin, args, opts] = spawn.mock.calls[0] as unknown as [string, string[], {cwd: string; env: object}];
        expect(bin).toBe("/bin/claude");
        expect(args[0]).toBe("-p");
        expect(opts.cwd).toBe("/work");
        expect(opts.env).toEqual({HOME: "/home/x"});
    });

    it("rejects output that is not json", async () => {
        const claude = new ClaudeService("claude", fakeSpawn(() => ({stderr: "not logged in", code: 1})) as never, {});

        await expect(claude.run(request)).rejects.toThrow("claude exited 1 without a result: not logged in");
    });

    it("rejects an error result", async () => {
        const stdout = JSON.stringify({subtype: "error_max_turns", is_error: true, result: "too many"});
        const claude = new ClaudeService("claude", fakeSpawn(() => ({stdout})) as never, {});

        await expect(claude.run(request)).rejects.toThrow("claude failed (error_max_turns): too many");
    });

    it("stops claude when it runs past the timeout", async () => {
        vi.useFakeTimers();
        const spawn = fakeSpawn(() => null);
        const claude = new ClaudeService("claude", spawn as never, {});

        const running = claude.run({...request, timeoutMs: 45 * 60_000});
        const assertion = expect(running).rejects.toThrow("claude ran past 45 minutes");
        await vi.advanceTimersByTimeAsync(45 * 60_000);
        await assertion;
        expect((spawn.mock.results[0].value as FakeChild).kill).toHaveBeenCalledWith("SIGTERM");
        vi.useRealTimers();
    });

    it("stops claude when the run is stopped", async () => {
        const spawn = fakeSpawn(() => null);
        const claude = new ClaudeService("claude", spawn as never, {});
        const stop = new AbortController();

        const running = claude.run({...request, signal: stop.signal});
        stop.abort();

        await expect(running).rejects.toThrow("stopped");
        expect((spawn.mock.results[0].value as FakeChild).kill).toHaveBeenCalledWith("SIGTERM");
    });
});
