import type {Request, Response, NextFunction} from "express";

export function isSameOrigin(req: Request): boolean {
    const site = req.get("sec-fetch-site");
    if (site) return site === "same-origin";
    const origin = req.get("origin");
    return origin ? URL.parse(origin)?.host === req.get("host") : false;
}

export function createSameOrigin(onRefuse: (req: Request, res: Response) => void) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.method === "GET" || req.method === "HEAD" || isSameOrigin(req)) return next();
        onRefuse(req, res);
    };
}
