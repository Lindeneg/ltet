import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import express from "express";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import {makePublicRouter} from "../../../src/routers/public-router.js";
import type PageService from "../../../src/services/page-service.js";
import {fake} from "../helpers.js";
import {serve, type Served} from "../serve.js";

describe("public router", () => {
    let pages: Record<
        | "getTable"
        | "getResults"
        | "getMatch"
        | "getNotFound"
        | "getServerError"
        | "getRace"
        | "getHonours"
        | "getRules"
        | "getClub",
        Mock
    >;
    let server: Served;

    const get = (path: string, init: RequestInit = {}) => fetch(server.url + path, {redirect: "manual", ...init});

    beforeEach(async () => {
        pages = {
            getTable: vi.fn().mockResolvedValue(success("<p>table</p>")),
            getResults: vi.fn().mockResolvedValue(success("<p>results</p>")),
            getMatch: vi.fn().mockResolvedValue(success("<p>match</p>")),
            getNotFound: vi.fn().mockResolvedValue("<p>404</p>"),
            getServerError: vi.fn().mockResolvedValue("<p>500</p>"),
            getRace: vi.fn().mockResolvedValue(success("<p>race</p>")),
            getHonours: vi.fn().mockResolvedValue(success("<p>honours</p>")),
            getRules: vi.fn().mockResolvedValue(success("<p>rules</p>")),
            getClub: vi.fn().mockResolvedValue(failure(AppError.NOT_FOUND)),
        };
        const app = express();
        app.use((req, _res, next) => {
            req.log = fake({error: vi.fn()});
            next();
        });
        app.use(makePublicRouter({pageService: fake<PageService>(pages), publicUrl: undefined}));
        server = await serve(app);
    });

    afterEach(() => server.close());

    it("serves the all-time table at / with the request's origin", async () => {
        const res = await get("/");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/html/);
        expect(await res.text()).toBe("<p>table</p>");
        expect(pages.getTable).toHaveBeenCalledWith({season: undefined}, server.url);
    });

    it("serves the table of a season at its prefix", async () => {
        const res = await get("/25-26");

        expect(res.status).toBe(200);
        expect(pages.getTable).toHaveBeenCalledWith({season: "25-26"}, server.url);
    });

    it.each([
        ["/all-time", "/"],
        ["/all-time/", "/"],
        ["/all-time/results?ceo=musk&sort=pitchforks", "/results?ceo=musk&sort=pitchforks"],
        ["/all-time/club/altman", "/club/altman"],
        ["/all-time?x=1", "/?x=1"],
        ["/all-time//other.example", "/other.example"],
    ])("moves %s to %s for good", async (path, target) => {
        const res = await get(path);

        expect(res.status).toBe(301);
        expect(res.headers.get("location")).toBe(target);
        expect(pages.getTable).not.toHaveBeenCalled();
    });

    it("sends the 404 page when the page service finds nothing", async () => {
        pages.getTable.mockResolvedValue(failure(AppError.NOT_FOUND));

        const res = await get("/99-00");

        expect(res.status).toBe(404);
        expect(await res.text()).toBe("<p>404</p>");
    });

    it("sends the 500 page when the database fails", async () => {
        pages.getTable.mockResolvedValue(failure(AppError.DB_ERROR));

        const res = await get("/");

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("<p>500</p>");
    });

    it("sends the 500 page when a view throws", async () => {
        pages.getTable.mockRejectedValue(new Error("broken view"));

        const res = await get("/");

        expect(res.status).toBe(500);
        expect(await res.text()).toBe("<p>500</p>");
    });

    it("uses the public url for the front page's base when it has one", async () => {
        const app = express();
        app.use(makePublicRouter({pageService: fake<PageService>(pages), publicUrl: "https://ltet.example"}));
        const other = await serve(app);

        await fetch(other.url + "/");
        await other.close();

        expect(pages.getTable).toHaveBeenCalledWith({season: undefined}, "https://ltet.example");
    });

    it("passes the results filters on as they come", async () => {
        const res = await get("/25-26/results?ceo=musk&count=doom&sort=pitchforks&utm_source=x");

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<p>results</p>");
        expect(pages.getResults).toHaveBeenCalledWith(
            {season: "25-26"},
            {ceo: "musk", count: "doom", sort: "pitchforks"}
        );
    });

    it("sends the 404 page for a repeated filter", async () => {
        const res = await get("/results?ceo=musk&ceo=altman");

        expect(res.status).toBe(404);
        expect(pages.getResults).not.toHaveBeenCalled();
    });

    it("serves a match report by its id", async () => {
        const res = await get("/match/altman-2025-09-01-statement");

        expect(res.status).toBe(200);
        expect(pages.getMatch).toHaveBeenCalledWith("altman-2025-09-01-statement");
    });

    it("answers a missing file with a plain 404 rather than the page", async () => {
        const res = await get("/missing.css");

        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await res.text()).toBe("Not found");
        expect(pages.getNotFound).not.toHaveBeenCalled();
    });

    it.each(["/nope", "/rules-of-nothing", "/club/nobody", "/25-26/nothing"])(
        "sends the 404 page for %s",
        async (path) => {
            const res = await get(path);

            expect(res.status).toBe(404);
            expect(await res.text()).toBe("<p>404</p>");
            expect(pages.getTable).not.toHaveBeenCalled();
        }
    );

    it("leaves other methods to the next handler", async () => {
        const res = await get("/nope", {method: "POST"});

        expect(res.status).toBe(404);
        expect(pages.getNotFound).not.toHaveBeenCalled();
    });

    it.each([
        ["/race", "getRace", undefined],
        ["/25-26/race", "getRace", "25-26"],
        ["/honours", "getHonours", undefined],
        ["/25-26/honours", "getHonours", "25-26"],
    ] as const)("serves %s for its season", async (path, method, season) => {
        const res = await get(path);

        expect(res.status).toBe(200);
        expect(pages[method]).toHaveBeenCalledWith({season});
    });

    it.each([
        ["/club/altman", undefined],
        ["/25-26/club/altman", "25-26"],
    ])("serves a contender's page at %s", async (path, season) => {
        pages.getClub.mockResolvedValue(success("<p>club</p>"));

        const res = await get(path);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<p>club</p>");
        expect(pages.getClub).toHaveBeenCalledWith({season}, "altman");
    });

    it("serves the rules without a season", async () => {
        const res = await get("/rules");

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<p>rules</p>");
    });

    it.each(["/25-26/rules", "/nope/race", "/club"])("sends the 404 page for %s", async (path) => {
        const res = await get(path);

        expect(res.status).toBe(404);
        expect(pages.getRules).not.toHaveBeenCalled();
        expect(pages.getRace).not.toHaveBeenCalled();
    });
});
