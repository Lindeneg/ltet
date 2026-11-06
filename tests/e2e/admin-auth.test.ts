import {describe, expect, it} from "vitest";
import {BASE_URL, cookieFrom, env, get, login, postForm, superUser} from "./helpers.js";

const email = superUser.email;
const password = superUser.password;

// each test that fails logins on purpose comes from its own address, so the lockout doesn't reach the others
let address = 10;
const fromAddress = () => ({origin: BASE_URL, "x-forwarded-for": `203.0.113.${address++}`});

describe("the cms login", () => {
    it("sends a visitor who isn't signed in to the login", async () => {
        for (const path of ["/admin", "/admin/statements", "/admin/runs/1", "/admin/settings", "/admin/nowhere"]) {
            const res = await get(path);
            expect(res.status, path).toBe(302);
            expect(res.location, path).toBe("/admin/login");
        }
    });

    it("shows the login form", async () => {
        const res = await get("/admin/login");

        expect(res.status).toBe(200);
        expect(res.html).toContain("Log in");
        expect(res.html).toContain(`name="email"`);
        expect(res.html).toContain(`name="password"`);
    });

    it("signs the owner in with a cookie only the cms gets", async () => {
        const res = await postForm("/admin/login", {email, password});

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin");
        const cookie = res.setCookies.find((c) => c.startsWith(`${env.JWT_COOKIE_NAME}=`)) ?? "";
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).toContain("Path=/admin");
        expect((await get("/admin", cookieFrom(res))).status).toBe(200);
    });

    it("refuses a wrong password, no sooner than half a second", async () => {
        const started = Date.now();
        const res = await postForm("/admin/login", {email, password: "not the password"}, undefined, fromAddress());

        expect(Date.now() - started).toBeGreaterThanOrEqual(490);
        expect(res.status).toBe(401);
        expect(res.html).toContain("Wrong email or password.");
        expect(res.html).toContain(`value="${email}"`);
        expect(cookieFrom(res)).toBeUndefined();
    });

    it("refuses an unknown email the same way", async () => {
        const res = await postForm("/admin/login", {email: "nobody@example.com", password}, undefined, fromAddress());

        expect(res.status).toBe(401);
        expect(res.html).toContain("Wrong email or password.");
    });

    it("refuses a form that isn't an email and a password", async () => {
        const res = await postForm("/admin/login", {email: "not an email"}, undefined, fromAddress());

        expect(res.status).toBe(400);
        expect(res.html).toContain("Wrong email or password.");
    });

    it("locks an address out after 5 wrong passwords, even with the right one", async () => {
        const headers = fromAddress();
        for (let i = 0; i < 5; i++) {
            const res = await postForm("/admin/login", {email, password: `wrong ${i}`}, undefined, headers);
            expect(res.status).toBe(401);
        }

        const locked = await postForm("/admin/login", {email, password}, undefined, headers);

        expect(locked.status).toBe(429);
        expect(locked.html).toContain("Too many tries. Wait a quarter of an hour.");
        expect(cookieFrom(locked)).toBeUndefined();
        expect((await postForm("/admin/login", {email, password}, undefined, fromAddress())).status).toBe(302);
    });

    it("doesn't count a good login toward the lockout", async () => {
        const headers = fromAddress();
        for (let i = 0; i < 4; i++) {
            await postForm("/admin/login", {email, password: `wrong ${i}`}, undefined, headers);
        }
        for (let i = 0; i < 3; i++) {
            expect((await postForm("/admin/login", {email, password}, undefined, headers)).status).toBe(302);
        }
    });

    it("refuses a change from another site", async () => {
        const cookie = await login();
        const crossSite: Array<Record<string, string>> = [
            {origin: "https://evil.example"},
            {"sec-fetch-site": "cross-site", origin: BASE_URL},
            {},
        ];

        for (const headers of crossSite) {
            const res = await postForm("/admin/logout", {}, cookie, headers);
            expect(res.status).toBe(403);
            expect(res.html).toContain("Requests must come from the CMS itself.");
        }
        expect((await postForm("/admin/login", {email, password}, undefined, {})).status).toBe(403);
    });

    it("logs out", async () => {
        const cookie = await login();

        const res = await postForm("/admin/logout", {}, cookie);

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin/login");
        expect(res.setCookies.some((c) => c.startsWith(`${env.JWT_COOKIE_NAME}=;`))).toBe(true);
    });

    it("ends the session, so a copy of the cookie stops working", async () => {
        const cookie = await login();
        const other = await login();
        expect((await get("/admin", cookie)).status).toBe(200);

        await postForm("/admin/logout", {}, cookie);

        for (const old of [cookie, other]) {
            const res = await get("/admin", old);
            expect(res.status).toBe(302);
            expect(res.location).toBe("/admin/login");
        }
        expect((await get("/admin", await login())).status).toBe(200);
    });

    it("signs in whatever case the email is typed in", async () => {
        const res = await postForm("/admin/login", {email: `  ${email.toUpperCase()} `, password});

        expect(res.status).toBe(302);
        expect((await get("/admin", cookieFrom(res))).status).toBe(200);
    });

    it("rejects a tampered cookie", async () => {
        const cookie = await login();

        const res = await get("/admin", `${cookie}x`);

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin/login");
    });
});

describe("the password change", () => {
    const change = (cookie: string, fields: Record<string, string>, headers?: Record<string, string>) =>
        postForm("/admin/settings/password", fields, cookie, headers);

    it("shows the settings page", async () => {
        const res = await get("/admin/settings", await login());

        expect(res.status).toBe(200);
        expect(res.html).toContain("Changing it signs out every other session.");
        expect(res.html).toContain(`aria-current="page">Settings`);
    });

    it("checks the new password", async () => {
        const cookie = await login();

        const short = await change(cookie, {currentPassword: password, newPassword: "short", confirmPassword: "short"});
        expect(short.status).toBe(400);
        expect(short.html).toContain("Use at least 12 characters");

        const long = "æ".repeat(37);
        const tooLong = await change(cookie, {currentPassword: password, newPassword: long, confirmPassword: long});
        expect(tooLong.status).toBe(400);
        expect(tooLong.html).toContain("Use at most 72 bytes (letters like æøå count as 2)");

        const mismatch = await change(cookie, {
            currentPassword: password,
            newPassword: "a long new password",
            confirmPassword: "another long password",
        });
        expect(mismatch.status).toBe(400);
        expect(mismatch.html).toContain("Passwords don&#39;t match");
    });

    it("refuses a wrong current password and locks out after 5", async () => {
        const cookie = await login();
        const headers = fromAddress();
        const fields = {
            currentPassword: "wrong",
            newPassword: "a long new password",
            confirmPassword: "a long new password",
        };
        for (let i = 0; i < 5; i++) {
            const res = await change(cookie, fields, headers);
            expect(res.status).toBe(401);
            expect(res.html).toContain("Wrong password");
        }

        const locked = await change(cookie, {...fields, currentPassword: password}, headers);

        expect(locked.status).toBe(429);
        expect(locked.html).toContain("Too many tries. Wait a quarter of an hour.");
        expect((await postForm("/admin/login", {email, password}, undefined, headers)).status).toBe(302);
    });

    it("changes it, keeps this session and signs out the others", async () => {
        const cookie = await login();
        const other = await login();
        const next = "a brand new password";

        const res = await change(cookie, {currentPassword: password, newPassword: next, confirmPassword: next});

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin/settings?password=changed");
        const fresh = cookieFrom(res)!;
        expect((await get("/admin/settings?password=changed", fresh)).html).toContain("Password changed");
        expect((await get("/admin", other)).status).toBe(302);
        expect((await get("/admin", cookie)).status).toBe(302);
        expect((await postForm("/admin/login", {email, password}, undefined, fromAddress())).status).toBe(401);

        const restored = await change(fresh, {currentPassword: next, newPassword: password, confirmPassword: password});
        expect(restored.status).toBe(302);
        expect(await login()).toBeTruthy();
    });
});

describe("the version line", () => {
    it("shows on the login and the cms pages, and dev without a build", async () => {
        const cookie = await login();
        for (const res of [
            await get("/admin/login"),
            await get("/admin", cookie),
            await get("/admin/settings", cookie),
        ]) {
            expect(res.html).toContain(`<footer class="version">Version dev</footer>`);
        }
    });

    it("stays off the public site", async () => {
        expect((await get("/")).html).not.toContain(`class="version"`);
    });
});
