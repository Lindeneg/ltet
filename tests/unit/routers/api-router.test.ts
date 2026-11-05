import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import express from "express";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import LeagueService from "../../../src/services/league-service.js";
import FeedbackService from "../../../src/services/feedback-service.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import {makeApiRouter} from "../../../src/routers/api-router.js";
import {fake, makeContent, makeStatement, makeContentService} from "../helpers.js";
import {serve, type Served} from "../serve.js";

const content = makeContent();
const STATEMENT = makeStatement().id;

describe("api router", () => {
    let server: Served;
    let create: Mock;
    let listPublished: Mock;

    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${server.url}/api${path}`, {
            method: "POST",
            headers: {"content-type": "application/json", "sec-fetch-site": "same-origin", ...headers},
            body: typeof body === "string" ? body : JSON.stringify(body),
        });

    const dispute = {statementId: STATEMENT, category: "doom", direction: "fewer", comment: "  Too harsh  "};
    const suggestion = {url: "https://one.example/a", ceo: "musk", quote: " words ", note: " a note "};

    beforeEach(async () => {
        create = vi.fn().mockResolvedValue(success(1));
        listPublished = vi.fn().mockResolvedValue(success([makeStatement()]));
        const leagueService = new LeagueService(
            fake<StatementRepository>({listPublished}),
            makeContentService(content)
        );
        const feedbackService = new FeedbackService(fake<ProposalRepository>({create}));
        const app = express();
        app.use("/api", makeApiRouter({feedbackService, leagueService, content: makeContentService(content)}));
        app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
            res.status(500).send("error");
        });
        server = await serve(app);
    });

    afterEach(() => server.close());

    it("takes a dispute with its comment trimmed", async () => {
        const res = await post("/dispute", dispute);

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ok: true});
        expect(create).toHaveBeenCalledWith({
            kind: "dispute",
            origin: "visitor",
            statementId: STATEMENT,
            body: {category: "doom", direction: "fewer", comment: "Too harsh"},
        });
    });

    it("cuts a comment to 500 characters", async () => {
        await post("/dispute", {...dispute, comment: "x".repeat(600)});

        expect(create.mock.calls[0][0].body.comment).toHaveLength(500);
    });

    it.each([
        ["an unknown statement", {...dispute, statementId: "nobody"}, "No such statement."],
        ["no statement", {...dispute, statementId: undefined}, "No such statement."],
        ["an unknown count", {...dispute, category: "vibes"}, "Pick one of the counts."],
        ["no direction", {...dispute, direction: "sideways"}, "More or fewer?"],
    ])("rejects a dispute with %s", async (_, body, error) => {
        const res = await post("/dispute", body);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({error});
        expect(create).not.toHaveBeenCalled();
    });

    it("takes a suggestion with its fields trimmed", async () => {
        const res = await post("/suggest", suggestion);

        expect(res.status).toBe(202);
        expect(create).toHaveBeenCalledWith({
            kind: "suggestion",
            origin: "visitor",
            body: {url: "https://one.example/a", ceo: "musk", quote: "words", note: "a note"},
        });
    });

    it("takes a suggestion about an unknown contender as about nobody, and cuts its quote", async () => {
        await post("/suggest", {...suggestion, ceo: "nobody", quote: "q".repeat(1200)});

        const body = create.mock.calls[0][0].body;
        expect(body.ceo).toBeNull();
        expect(body.quote).toHaveLength(1000);
    });

    it.each(["", "not a link", "ftp://one.example/a"])("rejects a suggestion with the link %j", async (url) => {
        const res = await post("/suggest", {...suggestion, url});

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({error: "A link to where it was said or reported, please."});
    });

    it("tells a bot that fills the hidden website field it worked, and keeps nothing", async () => {
        const res = await post("/suggest", {...suggestion, website: "https://spam.example"});

        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ok: true});
        expect(create).not.toHaveBeenCalled();
    });

    it.each([
        ["another site", {"sec-fetch-site": "cross-site"}],
        ["another origin without fetch metadata", {"sec-fetch-site": "", origin: "https://evil.example"}],
        ["neither header", {"sec-fetch-site": ""}],
    ])("refuses feedback from %s", async (_, headers) => {
        const res = await post("/suggest", suggestion, headers);

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({error: "Send it from the site."});
    });

    it("takes feedback from its own origin without fetch metadata", async () => {
        const host = new URL(server.url).host;

        const res = await post("/suggest", suggestion, {"sec-fetch-site": "", origin: `http://${host}`});

        expect(res.status).toBe(202);
    });

    it("refuses a body that is not json", async () => {
        const res = await fetch(`${server.url}/api/suggest`, {
            method: "POST",
            headers: {"sec-fetch-site": "same-origin"},
            body: new URLSearchParams({url: suggestion.url}),
        });

        expect(res.status).toBe(403);
    });

    it("keeps 400 for malformed json and 413 for a body over 8kb", async () => {
        expect((await post("/suggest", "{nope")).status).toBe(400);
        expect((await post("/suggest", {...suggestion, note: "x".repeat(9000)})).status).toBe(413);
    });

    it("answers 429 after 10 taken in an hour, where rejected ones don't count", async () => {
        for (let i = 0; i < 5; i++) expect((await post("/suggest", {...suggestion, url: "nope"})).status).toBe(400);
        for (let i = 0; i < 10; i++) expect((await post("/suggest", suggestion)).status).toBe(202);

        const res = await post("/dispute", dispute);

        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({error: "That is a lot of feedback. Try again later."});
        expect(create).toHaveBeenCalledTimes(10);
    });

    it("passes a failed save on as an error", async () => {
        create.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await post("/suggest", suggestion)).status).toBe(500);
    });

    // a save as slow as a real write, so every request in a burst passes the check before any is saved
    const slowSave = () =>
        create.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return success(1);
        });

    it("takes exactly 10 of a parallel burst from one address", async () => {
        slowSave();

        const statuses = await Promise.all(Array.from({length: 30}, () => post("/suggest", suggestion)));

        expect(statuses.filter((r) => r.status === 202)).toHaveLength(10);
        expect(statuses.filter((r) => r.status === 429)).toHaveLength(20);
        expect(create).toHaveBeenCalledTimes(10);
        expect((await post("/suggest", suggestion)).status).toBe(429);
    });

    it("gives back the places of rejected requests in the same burst", async () => {
        slowSave();
        const bad = Array.from({length: 10}, () => post("/suggest", {...suggestion, url: "nope"}));
        await Promise.all(bad);

        const good = await Promise.all(Array.from({length: 10}, () => post("/suggest", suggestion)));

        expect(good.map((r) => r.status)).toEqual(Array(10).fill(202));
    });

    it("gives the place back when the league can't load", async () => {
        listPublished.mockResolvedValue(failure(AppError.DB_ERROR));
        for (let i = 0; i < 10; i++) expect((await post("/dispute", dispute)).status).toBe(500);

        listPublished.mockResolvedValue(success([makeStatement()]));

        expect((await post("/dispute", dispute)).status).toBe(202);
    });
});
