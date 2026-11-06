import type {SitemapEntry} from "../../../services/sitemap-service.js";
import {esc} from "../../lib.js";

function w3cDate(time: number): string {
    return new Date(time).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function SitemapView(base: string, entries: SitemapEntry[]): string {
    const urls = entries.map(({path, lastmod}) => {
        const mod = lastmod === null ? "" : `<lastmod>${w3cDate(lastmod)}</lastmod>`;
        return `  <url><loc>${esc(base + path)}</loc>${mod}</url>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

export function RobotsView(base: string): string {
    return `User-agent: *
Disallow: /admin
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`;
}
