import pino, {type DestinationStream, type LevelWithSilent, type LogFn, type Logger, type LoggerOptions} from "pino";
import {pinoHttp} from "pino-http";
import type {Request} from "express";
import type {NodeEnv} from "../lib/types.js";

const defaultLevels: Record<NodeEnv, LevelWithSilent> = {
    test: "silent",
    development: "debug",
    production: "info",
};

class LoggerService {
    readonly #logger: Logger;

    constructor(nodeEnv: NodeEnv, level?: LevelWithSilent, destination?: DestinationStream) {
        const options: LoggerOptions = {
            level: level ?? defaultLevels[nodeEnv],
            redact: {
                paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
                censor: "[redacted]",
            },
            transport:
                nodeEnv === "production" || destination
                    ? undefined
                    : {
                          target: "pino-pretty",
                          options: {
                              colorize: true,
                              translateTime: "HH:MM:ss",
                              ignore: "pid,hostname,req,res,reqId,responseTime,userId",
                          },
                      },
        };
        this.#logger = destination ? pino(options, destination) : pino(options);
    }

    trace(...args: Parameters<LogFn>) {
        this.#logger.trace(...args);
    }
    debug(...args: Parameters<LogFn>) {
        this.#logger.debug(...args);
    }
    info(...args: Parameters<LogFn>) {
        this.#logger.info(...args);
    }
    warn(...args: Parameters<LogFn>) {
        this.#logger.warn(...args);
    }
    error(...args: Parameters<LogFn>) {
        this.#logger.error(...args);
    }
    fatal(...args: Parameters<LogFn>) {
        this.#logger.fatal(...args);
    }

    makeRequestLogger() {
        return pinoHttp({
            logger: this.#logger,
            quietReqLogger: true,
            customSuccessMessage: (req, res, responseTime) => {
                const r = req as Request;
                const user = r.auth ? ` user=${r.auth.id}` : "";
                return `${req.id} ${req.method} ${req.url} ${res.statusCode}${user} ${responseTime}ms`;
            },
            customErrorMessage: (req, res, err) => {
                const r = req as Request;
                const user = r.auth ? ` user=${r.auth.id}` : "";
                return `${req.id} ${req.method} ${req.url} ${res.statusCode}${user} ${err.message}`;
            },
        });
    }
}

export default LoggerService;
