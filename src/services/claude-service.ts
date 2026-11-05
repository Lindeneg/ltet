import {spawn as nodeSpawn} from "node:child_process";

export type ClaudeRequest = {
    prompt: string;
    schema: object;
    tools?: string[];
    model: string;
    timeoutMs: number;
    cwd: string;
    signal?: AbortSignal;
};

export type ClaudeAnswer<T> = {output: T; costUsd: number; turns: number};

type ClaudeResult = {
    is_error?: boolean;
    subtype?: string;
    result?: unknown;
    structured_output?: unknown;
    total_cost_usd?: number;
    num_turns?: number;
};

export function claudeArgs({
    schema,
    tools = [],
    model,
}: Omit<ClaudeRequest, "prompt" | "timeoutMs" | "cwd" | "signal">): string[] {
    const args = [
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(schema),
        "--model",
        model,
        "--no-session-persistence",
        "--strict-mcp-config",
        "--restricted",
        "--permission-mode",
        "dontAsk",
        "--tools",
        tools.join(","),
    ];
    if (tools.length > 0) args.push("--allowedTools", ...tools);
    return args;
}

class ClaudeService {
    constructor(
        private readonly bin: string,
        private readonly spawn: typeof nodeSpawn = nodeSpawn,
        private readonly env: NodeJS.ProcessEnv = process.env
    ) {}

    run<T>(request: ClaudeRequest): Promise<ClaudeAnswer<T>> {
        return new Promise((resolve, reject) => {
            // in print mode claude code bills the api key whenever it is set, so the run always uses the login
            const {ANTHROPIC_API_KEY: _, ...env} = this.env;
            const child = this.spawn(this.bin, claudeArgs(request), {
                cwd: request.cwd,
                env,
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            const timer = setTimeout(() => {
                child.kill("SIGTERM");
                reject(new Error(`claude ran past ${Math.round(request.timeoutMs / 60_000)} minutes`));
            }, request.timeoutMs);
            const abort = () => {
                clearTimeout(timer);
                child.kill("SIGTERM");
                reject(new Error("stopped"));
            };
            if (request.signal?.aborted) abort();
            request.signal?.addEventListener("abort", abort, {once: true});
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk;
            });
            child.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                request.signal?.removeEventListener("abort", abort);
                let result: ClaudeResult;
                try {
                    result = JSON.parse(stdout);
                } catch {
                    return reject(
                        new Error(`claude exited ${code} without a result: ${(stderr || stdout).slice(0, 500)}`)
                    );
                }
                if (result.is_error || result.subtype !== "success" || !result.structured_output) {
                    return reject(
                        new Error(`claude failed (${result.subtype}): ${String(result.result ?? "").slice(0, 500)}`)
                    );
                }
                resolve({
                    output: result.structured_output as T,
                    costUsd: result.total_cost_usd ?? 0,
                    turns: result.num_turns ?? 0,
                });
            });
            child.stdin.end(request.prompt);
        });
    }
}

export default ClaudeService;
