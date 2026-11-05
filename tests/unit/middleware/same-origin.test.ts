import {afterAll, beforeAll, describe, expect, it} from "vitest";
import express from "express";
import {createSameOrigin} from "../../../src/middleware/same-origin.js";
import {serve, type Served} from "../serve.js";

describe("createSameOrigin", () => {
    let server: Served;

    beforeAll(async () => {
        const app = express();
        app.use(createSameOrigin((_req, res) => void res.status(403).send("refused")));
        app.all("/", (_req, res) => void res.send("ok"));
        server = await serve(app);
    });

    afterAll(() => server.close());

    const call = (method: string, headers: Record<string, string> = {}) => fetch(server.url, {method, headers});

    it("lets reads through from anywhere", async () => {
        expect((await call("GET", {origin: "https://evil.example"})).status).toBe(200);
    });

    it("lets a change from the same origin through", async () => {
        expect((await call("POST", {"sec-fetch-site": "same-origin"})).status).toBe(200);
        expect((await call("POST", {origin: server.url})).status).toBe(200);
    });

    it("refuses a change from another site", async () => {
        const crossSite: Array<Record<string, string>> = [
            {"sec-fetch-site": "cross-site"},
            {"sec-fetch-site": "same-site", origin: server.url},
            {origin: "https://evil.example"},
            {origin: "null"},
            {},
        ];
        for (const headers of crossSite) {
            const res = await call("POST", headers);
            expect(res.status, JSON.stringify(headers)).toBe(403);
            expect(await res.text()).toBe("refused");
        }
    });
});
