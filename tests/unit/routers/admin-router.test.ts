import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import express, {Router} from "express";
import {failure, success} from "../../../src/lib/result.js";
import {createAdminAuth} from "../../../src/middleware/admin-auth.js";
import {createSameOrigin} from "../../../src/middleware/same-origin.js";
import {makeAdminRouter} from "../../../src/routers/admin-router.js";
import {notFoundRouter} from "../../../src/routers/admin/not-found.js";
import AuthService, {AuthError} from "../../../src/services/auth-service.js";
import type ProposalService from "../../../src/services/proposal-service.js";
import {fake, makeUser} from "../helpers.js";
import {serve, type Served} from "../serve.js";

describe("admin router", () => {
    let authenticate: ReturnType<typeof vi.fn>;
    let server: Served;

    const call = (path: string, init: RequestInit = {}) =>
        fetch(`${server.url}/admin${path}`, {redirect: "manual", ...init});

    beforeEach(async () => {
        authenticate = vi.fn().mockResolvedValue(success(makeUser()));
        const auth = fake<AuthService>({getToken: () => "token", authenticate});
        const proposals = fake<ProposalService>({openTotal: vi.fn().mockResolvedValue(success(2))});
        const app = express();
        app.use(
            "/admin",
            makeAdminRouter(
                createSameOrigin((_req, res) => void res.status(403).send("refused")),
                Router()
                    .get("/login", (_req, res) => void res.send("login"))
                    .post("/login", (_req, res) => void res.send("logged in")),
                createAdminAuth(auth),
                [Router().get("/", (_req, res) => void res.send("inbox")), notFoundRouter(proposals)]
            )
        );
        server = await serve(app);
    });

    afterEach(() => server.close());

    it("serves the login page without a session", async () => {
        authenticate.mockResolvedValue(failure(AuthError.UNAUTHENTICATED));

        expect(await (await call("/login")).text()).toBe("login");
    });

    it("sends everything else to login without a session, unknown paths included", async () => {
        authenticate.mockResolvedValue(failure(AuthError.UNAUTHENTICATED));

        for (const path of ["", "/", "/does-not-exist"]) {
            const res = await call(path);
            expect(res.status, path).toBe(302);
            expect(res.headers.get("location"), path).toBe("/admin/login");
        }
    });

    it("serves the cms with a session", async () => {
        expect(await (await call("")).text()).toBe("inbox");
    });

    it("answers an unknown cms path with the cms 404 page", async () => {
        const res = await call("/does-not-exist");

        expect(res.status).toBe(404);
        const html = await res.text();
        expect(html).toContain("Page not found");
        expect(html).toContain(`<span class="badge">2</span>`);
    });

    it("refuses a change from another site before anything else, the login included", async () => {
        for (const path of ["/login", "/does-not-exist"]) {
            const res = await call(path, {method: "POST", headers: {origin: "https://evil.example"}});
            expect(res.status, path).toBe(403);
        }
        expect(authenticate).not.toHaveBeenCalled();
    });
});
