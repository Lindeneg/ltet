import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import express from "express";
import {failure, success} from "../../../src/lib/result.js";
import {loginRouter, logoutRouter} from "../../../src/routers/admin/auth.js";
import AuthService, {AuthError} from "../../../src/services/auth-service.js";
import {fake, makeUser} from "../helpers.js";
import {serve, type Served} from "../serve.js";

describe("login router", () => {
    let login: Mock;
    let setAuthCookies: Mock;
    let server: Served;

    const attempt = (fields: Record<string, string> = {email: "a@example.com", password: "wrong"}) =>
        fetch(`${server.url}/login`, {method: "POST", body: new URLSearchParams(fields), redirect: "manual"});

    async function start(floorMs = 0) {
        const app = express();
        app.use(express.urlencoded({extended: true}));
        app.use(loginRouter(fake<AuthService>({login, setAuthCookies}), floorMs));
        server = await serve(app);
    }

    beforeEach(async () => {
        login = vi.fn().mockResolvedValue(failure(AuthError.INVALID_CREDENTIALS));
        setAuthCookies = vi.fn((res) => res.cookie("auth", "token"));
        await start();
    });

    afterEach(() => server.close());

    it("renders the login form", async () => {
        const res = await fetch(`${server.url}/login`);

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`action="/admin/login"`);
        expect(html).toContain("Log in");
    });

    it("keeps the typed email when the credentials are wrong", async () => {
        const res = await attempt({email: "a@example.com", password: "wrong"});

        expect(res.status).toBe(401);
        const html = await res.text();
        expect(html).toContain("Wrong email or password.");
        expect(html).toContain(`value="a@example.com"`);
    });

    it("answers a wrong password no sooner than the floor", async () => {
        await server.close();
        await start(200);
        const started = Date.now();

        await attempt();

        expect(Date.now() - started).toBeGreaterThanOrEqual(195);
    });

    it("answers a form without an email with a 400 and doesn't ask the service", async () => {
        const res = await attempt({email: "nope", password: "x"});

        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Wrong email or password.");
        expect(login).not.toHaveBeenCalled();
    });

    it("answers a database failure with a 500", async () => {
        login.mockResolvedValue(failure(AuthError.DB_ERROR));

        const res = await attempt();

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("Something went wrong.");
    });

    it("sets the cookie and redirects to the inbox on success", async () => {
        login.mockResolvedValue(success("token"));

        const res = await attempt({email: "a@example.com", password: "right"});

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin");
        expect(setAuthCookies).toHaveBeenCalledOnce();
    });

    it("locks logins for the client after 5 wrong passwords, even with the right one", async () => {
        for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);

        login.mockResolvedValue(success("token"));
        const locked = await attempt({email: "a@example.com", password: "right"});

        expect(locked.status).toBe(429);
        const html = await locked.text();
        expect(html).toContain("Too many tries. Wait a quarter of an hour.");
        expect(html).toContain(`value="a@example.com"`);
        expect(login).toHaveBeenCalledTimes(5);
    });

    it("counts only wrong passwords toward the limit", async () => {
        login.mockResolvedValue(success("token"));
        for (let i = 0; i < 6; i++) expect((await attempt()).status).toBe(302);
        for (let i = 0; i < 6; i++) expect((await attempt({email: "nope", password: "x"})).status).toBe(400);
        login.mockResolvedValue(failure(AuthError.DB_ERROR));
        for (let i = 0; i < 6; i++) expect((await attempt()).status).toBe(500);

        login.mockResolvedValue(failure(AuthError.INVALID_CREDENTIALS));
        expect((await attempt()).status).toBe(401);
    });
});

describe("logout router", () => {
    async function logOut(result: Awaited<ReturnType<AuthService["logout"]>>) {
        const clearAuthCookies = vi.fn((res) => res.clearCookie("auth"));
        const logout = vi.fn().mockResolvedValue(result);
        const app = express();
        app.use((req, _res, next) => {
            req.auth = makeUser();
            next();
        });
        app.use(logoutRouter(fake<AuthService>({clearAuthCookies, logout})));
        const server = await serve(app);
        const res = await fetch(`${server.url}/logout`, {method: "POST", redirect: "manual"});
        await server.close();
        return {res, clearAuthCookies, logout};
    }

    it("ends the owner's sessions, clears the cookie and redirects to login", async () => {
        const {res, clearAuthCookies, logout} = await logOut(success(undefined));

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin/login");
        expect(logout).toHaveBeenCalledWith("user-1");
        expect(clearAuthCookies).toHaveBeenCalledOnce();
    });

    it("still clears the cookie when ending the sessions fails", async () => {
        const {res, clearAuthCookies} = await logOut(failure(AuthError.DB_ERROR));

        expect(res.status).toBe(302);
        expect(clearAuthCookies).toHaveBeenCalledOnce();
    });
});

describe("auth cookie", () => {
    const service = (mode: "production" | "development") =>
        new AuthService(
            fake({}),
            {cookieName: "auth", secret: "x".repeat(32), bcryptRounds: 4, expiryMs: 60_000, mode},
            fake({})
        );

    it("is httpOnly, lax, secure in production and only for the cms", () => {
        const cookie = vi.fn();
        service("production").setAuthCookies(fake({cookie}), "token");

        expect(cookie).toHaveBeenCalledWith("auth", "token", {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/admin",
            maxAge: 60_000,
        });
    });

    it("is not secure outside production, so it works over http locally", () => {
        const cookie = vi.fn();
        service("development").setAuthCookies(fake({cookie}), "token");

        expect(cookie).toHaveBeenCalledWith("auth", "token", expect.objectContaining({secure: false}));
    });

    it("is cleared on the path it was set on", () => {
        const clearCookie = vi.fn();
        service("development").clearAuthCookies(fake({clearCookie}));

        expect(clearCookie).toHaveBeenCalledWith("auth", {path: "/admin"});
    });
});
