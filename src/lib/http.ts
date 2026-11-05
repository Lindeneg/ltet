import type {Request, Response} from "express";

export const MAX_FORM_BYTES = 256 * 1024;

export function send(res: Response, html: string, status = 200) {
    res.status(status).type("html").send(html);
}

export function baseUrl(req: Request, publicUrl: string | undefined): string {
    return publicUrl ?? `${req.protocol}://${req.get("host")}`;
}
