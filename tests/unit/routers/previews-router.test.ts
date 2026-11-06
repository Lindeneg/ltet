import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import express from "express";
import {success} from "../../../src/lib/result.js";
import LeagueService from "../../../src/services/league-service.js";
import type PreviewService from "../../../src/services/preview-service.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {makePreviewsRouter} from "../../../src/routers/previews-router.js";
import {fake, makeContent, makeStatement, makeContentService} from "../helpers.js";
import {serve, type Served} from "../serve.js";

const NOW = Date.UTC(2026, 0, 15);
const PNG = Buffer.from("png");
const content = makeContent();
const long = "word ".repeat(50).trim();
const statements = [
    makeStatement(),
    makeStatement(
        {
            id: "musk-one",
            ceo: "musk",
            date: "2025-10-02",
            quote: long,
            headline: {text: `<Big> "news"`, outlet: "O", url: "https://o.example"},
        },
        {loss: 1, doom: 0}
    ),
];

describe("previews router", () => {
    let server: Served;
    let listPublished: Mock;
    let siteCard: Mock;
    let statementCard: Mock;

    async function start(publicUrl?: string) {
        const leagueService = new LeagueService(
            fake<StatementRepository>({listPublished}),
            makeContentService(content),
            () => NOW
        );
        const previewService = fake<PreviewService>({siteCard, statementCard});
        const app = express();
        app.use(makePreviewsRouter({leagueService, previewService, content: makeContentService(content), publicUrl}));
        app.use((_req, res) => {
            res.status(404).send("next");
        });
        app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(500).send("error");
        });
        server = await serve(app);
    }

    beforeEach(() => {
        listPublished = vi.fn().mockResolvedValue(success(statements));
        siteCard = vi.fn().mockResolvedValue(PNG);
        statementCard = vi.fn().mockResolvedValue(PNG);
    });

    afterEach(() => server.close());

    it("gives a share page the statement's own preview and forwards it to the match report", async () => {
        await start();

        const res = await fetch(`${server.url}/s/musk-one`, {redirect: "manual"});
        const html = await res.text();

        expect(res.status).toBe(200);
        expect(html).toContain(`<title>&lt;Big&gt; &quot;news&quot; | Let Them Eat Tokens</title>`);
        expect(html).toContain(`<meta property="og:url" content="${server.url}/s/musk-one">`);
        expect(html).toContain(`<meta property="og:image" content="${server.url}/og/musk-one.png">`);
        expect(html).toContain(`<meta property="og:image:width" content="1200">`);
        expect(html).toContain(`<meta http-equiv="refresh" content="0; url=/match/musk-one">`);
        expect(html).toContain(`<a href="/match/musk-one">Read what Elon Musk actually said</a>`);
        expect(html).toContain(`<meta name="robots" content="noindex">`);
        expect(html).toContain(`<link rel="canonical" href="${server.url}/match/musk-one">`);
        const quote = `${long.slice(0, 180).trimEnd()}…`;
        expect(html).toContain(`content="1 pitchfork. “${quote}” Elon Musk, 2 October 2025."`);
    });

    it("uses PUBLIC_URL for the share page's addresses when set", async () => {
        await start("https://ltet.example");

        const html = await (await fetch(`${server.url}/s/altman-2025-09-01-statement`)).text();

        expect(html).toContain(`<link rel="canonical" href="https://ltet.example/match/altman-2025-09-01-statement">`);
        expect(html).toContain(`content="https://ltet.example/og/altman-2025-09-01-statement.png"`);
        expect(html).toContain(
            `content="5 pitchforks. “These are the exact words that were said in public” Sam Altman, 1 September 2025."`
        );
    });

    it("redirects a share page for an unknown statement to the front page", async () => {
        await start();

        const res = await fetch(`${server.url}/s/nobody`, {redirect: "manual"});

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/");
    });

    it("serves the all-time card for a day", async () => {
        await start();

        const res = await fetch(`${server.url}/og.png`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
        expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
        expect(siteCard).toHaveBeenCalledWith("all-time", expect.any(Function));
        const card = siteCard.mock.calls[0][1]();
        expect(card.statements.map((s: {id: string}) => s.id)).toEqual(["altman-2025-09-01-statement", "musk-one"]);
    });

    it("serves a statement's card for a day", async () => {
        await start();

        const res = await fetch(`${server.url}/og/musk-one.png`);

        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
        expect(statementCard).toHaveBeenCalledWith(expect.objectContaining({id: "musk-one", forks: 1}));
    });

    it.each(["/og/nobody.png", "/og/musk-one", "/og/musk-one.jpg"])("passes %s on", async (path) => {
        await start();

        const res = await fetch(`${server.url}${path}`);

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("next");
        expect(statementCard).not.toHaveBeenCalled();
    });
});
