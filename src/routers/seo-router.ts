import {Router} from "express";
import {baseUrl} from "../lib/http.js";
import type {MaybeUndefined} from "../lib/types.js";
import type SitemapService from "../services/sitemap-service.js";
import {RobotsView, SitemapView} from "../ui/views/site/seo.js";

export type SeoDeps = {
    sitemapService: SitemapService;
    publicUrl: MaybeUndefined<string>;
};

export function makeSeoRouter({sitemapService, publicUrl}: SeoDeps): Router {
    const router = Router();

    router.get("/robots.txt", (req, res) => {
        res.type("text").send(RobotsView(baseUrl(req, publicUrl)));
    });

    router.get("/sitemap.xml", async (req, res, next) => {
        const entries = await sitemapService.get();
        if (!entries.ok) return next(new Error(`failed to build the sitemap: ${entries.ctx}`));
        res.type("application/xml").send(SitemapView(baseUrl(req, publicUrl), entries.data));
    });

    return router;
}
