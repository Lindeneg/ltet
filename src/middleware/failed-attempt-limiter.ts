import type {Request, Response} from "express";
import {rateLimit, type RateLimitRequestHandler} from "express-rate-limit";

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;

export const TOO_MANY_FAILED_ATTEMPTS = "Too many tries. Wait a quarter of an hour.";

export function failedAttemptLimiter(onLimit: (req: Request, res: Response) => void): RateLimitRequestHandler {
    return rateLimit({
        windowMs: WINDOW_MS,
        limit: LIMIT,
        skipSuccessfulRequests: true,
        requestWasSuccessful: (_req, res) => res.statusCode !== 401,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: onLimit,
    });
}
