import {vi} from "vitest";
import express, {type Router} from "express";
import {success} from "../../../src/lib/result.js";
import type ProposalService from "../../../src/services/proposal-service.js";
import {fake, makeUser} from "../helpers.js";
import {serve} from "../serve.js";

export async function serveAdmin(router: Router) {
    const app = express();
    app.use(express.urlencoded({extended: true}));
    app.use((req, _res, next) => {
        req.auth = makeUser();
        next();
    });
    app.use("/admin", router);
    const server = await serve(app);
    const get = (path: string) => fetch(`${server.url}${path}`, {redirect: "manual"});
    const post = (path: string, fields: Record<string, string>) =>
        fetch(`${server.url}${path}`, {method: "POST", body: new URLSearchParams(fields), redirect: "manual"});
    return {...server, get, post};
}

export function fakeProposalService(overrides: Record<string, unknown> = {}) {
    const impl = {
        openTotal: vi.fn().mockResolvedValue(success(3)),
        inbox: vi.fn().mockResolvedValue(success({items: [], counts: {}, page: 1, pages: 1})),
        lastPage: vi.fn().mockResolvedValue(success(1)),
        close: vi.fn().mockResolvedValue(success(undefined)),
        ...overrides,
    };
    return {impl, service: fake<ProposalService>(impl)};
}
