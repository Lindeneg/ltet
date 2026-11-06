import type {Request, Response, NextFunction} from "express";

export function noIndex(_req: Request, res: Response, next: NextFunction) {
    res.set("X-Robots-Tag", "noindex, nofollow");
    next();
}
