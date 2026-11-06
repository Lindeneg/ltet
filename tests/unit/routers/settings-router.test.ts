import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {settingsRouter} from "../../../src/routers/admin/settings.js";
import AuthService, {AuthError} from "../../../src/services/auth-service.js";
import type ScoutRunnerService from "../../../src/services/scout-runner-service.js";
import {AppError} from "../../../src/lib/errors.js";
import {fake} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

describe("settings router", () => {
    let changePassword: Mock;
    let setAuthCookies: Mock;
    let scoutTime: Mock;
    let setScoutTime: Mock;
    let claudeToken: Mock;
    let setClaudeToken: Mock;
    let removeClaudeToken: Mock;
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    const good = {
        currentPassword: "old password",
        newPassword: "a long new password",
        confirmPassword: "a long new password",
    };
    const change = (fields: Record<string, string> = good) => app.post("/admin/settings/password", fields);

    beforeEach(async () => {
        changePassword = vi.fn().mockResolvedValue(success("fresh token"));
        setAuthCookies = vi.fn();
        const auth = fake<AuthService>({changePassword, setAuthCookies});
        scoutTime = vi.fn().mockResolvedValue(success("06:00"));
        setScoutTime = vi.fn().mockResolvedValue(success(undefined));
        claudeToken = vi.fn().mockResolvedValue(success({source: "env", unreadable: false}));
        setClaudeToken = vi.fn().mockResolvedValue(success(undefined));
        removeClaudeToken = vi.fn().mockResolvedValue(success(undefined));
        const runner = fake<ScoutRunnerService>({
            scoutTime,
            setScoutTime,
            claudeToken,
            setClaudeToken,
            removeClaudeToken,
        });
        app = await serveAdmin(settingsRouter(auth, fakeProposalService().service, runner));
    });

    afterEach(() => app.close());

    it("shows the password form", async () => {
        const html = await (await app.get("/admin/settings")).text();

        expect(html).toContain("Changing it signs out every other session.");
        expect(html).toContain(`name="currentPassword"`);
        expect(html).not.toContain("Password changed");
    });

    it("says when the password was changed", async () => {
        expect(await (await app.get("/admin/settings?password=changed")).text()).toContain("Password changed");
    });

    it("changes the password and gives this session a fresh cookie", async () => {
        const res = await change();

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin/settings?password=changed");
        expect(changePassword).toHaveBeenCalledWith("user-1", "old password", "a long new password");
        expect(setAuthCookies).toHaveBeenCalledWith(expect.anything(), "fresh token");
    });

    it("checks the new password before asking the service", async () => {
        const cases: Array<[Record<string, string>, string]> = [
            [{...good, newPassword: "short", confirmPassword: "short"}, "Use at least 12 characters"],
            [
                {...good, newPassword: "æ".repeat(37), confirmPassword: "æ".repeat(37)},
                "Use at most 72 bytes (letters like æøå count as 2)",
            ],
            [{...good, confirmPassword: "something else"}, "Passwords don&#39;t match"],
            [{...good, currentPassword: ""}, "Required"],
        ];
        for (const [fields, message] of cases) {
            const res = await change(fields);
            expect(res.status, message).toBe(400);
            expect(await res.text()).toContain(message);
        }
        expect(changePassword).not.toHaveBeenCalled();
    });

    it("answers a wrong current password with a 401", async () => {
        changePassword.mockResolvedValue(failure(AuthError.INVALID_CREDENTIALS));

        const res = await change();

        expect(res.status).toBe(401);
        expect(await res.text()).toContain("Wrong password");
        expect(setAuthCookies).not.toHaveBeenCalled();
    });

    it("answers a failure with a 500", async () => {
        changePassword.mockResolvedValue(failure(AuthError.DB_ERROR));

        const res = await change();

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("Failed to change password");
    });

    it("locks after 5 wrong current passwords, counting nothing else", async () => {
        for (let i = 0; i < 6; i++) expect((await change({...good, confirmPassword: "x"})).status).toBe(400);
        changePassword.mockResolvedValue(failure(AuthError.INVALID_CREDENTIALS));
        for (let i = 0; i < 5; i++) expect((await change()).status).toBe(401);

        changePassword.mockResolvedValue(success("token"));
        const locked = await change();

        expect(locked.status).toBe(429);
        expect(await locked.text()).toContain("Too many tries. Wait a quarter of an hour.");
    });

    it("shows the scout's daily time", async () => {
        const html = await (await app.get("/admin/settings")).text();

        expect(html).toContain(`<input name="scoutTime" type="time" value="06:00" required />`);
        expect(html).toContain("The server starts the scout once a day at this time, in production only.");
    });

    it("saves the scout's time and says so", async () => {
        const res = await app.post("/admin/settings/scout", {scoutTime: "07:30"});

        expect(setScoutTime).toHaveBeenCalledWith("07:30");
        expect(res.headers.get("location")).toBe("/admin/settings?done=saved");
        expect(await (await app.get("/admin/settings?done=saved")).text()).toContain("Saved.");
    });

    it("refuses a time that isn't HH:MM", async () => {
        for (const scoutTime of ["7:30", "24:00", "06:60", "x", ""]) {
            const res = await app.post("/admin/settings/scout", {scoutTime});
            expect(res.status, scoutTime).toBe(400);
            expect(await res.text()).toContain("Use a time like 06:00.");
        }
        expect(setScoutTime).not.toHaveBeenCalled();
    });

    it("answers a failure to save the time with a 500", async () => {
        setScoutTime.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await app.post("/admin/settings/scout", {scoutTime: "07:30"})).status).toBe(500);
    });

    describe("the claude token", () => {
        const TOKEN = "sk-ant-oat01-the-pasted-token";
        const page = async () => (await app.get("/admin/settings")).text();

        it("shows a write only field and says where the token comes from", async () => {
            const html = await page();

            expect(html).toContain(
                `<input name="claudeToken" type="password" autocomplete="off" spellcheck="false" required />`
            );
            expect(html).toContain("Now from the server's environment.");
            expect(html).not.toContain("Remove token");

            claudeToken.mockResolvedValue(success({source: "none", unreadable: false}));
            expect(await page()).toContain("None set, so the scout can't log in to Claude.");

            claudeToken.mockResolvedValue(
                success({source: "cms", setAt: new Date("2026-11-06T10:00:00Z"), unreadable: false})
            );
            const cms = await page();
            expect(cms).toContain(`Now from the CMS, set <time datetime="2026-11-06T10:00:00.000Z"`);
            expect(cms).toContain("Remove token");
        });

        it("asks for the token again when the saved one can't be read", async () => {
            claudeToken.mockResolvedValue(success({source: "env", unreadable: true}));

            const html = await page();

            expect(html).toContain("The saved token can&#39;t be read, since the server&#39;s secret changed.");
            expect(html).toContain("Remove token");
        });

        it("saves the token with all whitespace taken out, and says so", async () => {
            const res = await app.post("/admin/settings/claude-token", {
                claudeToken: ` sk-ant-oat01-\nthe-pasted token\n`,
            });

            expect(setClaudeToken).toHaveBeenCalledWith("sk-ant-oat01-the-pastedtoken");
            expect(res.status).toBe(302);
            expect(res.headers.get("location")).toBe("/admin/settings?done=saved");
        });

        it("refuses an empty, too long or odd token without echoing it", async () => {
            const long = `${TOKEN}${"x".repeat(4096)}`;
            const cases: Array<[string, string]> = [
                ["", "Paste the token."],
                [" \n ", "Paste the token."],
                [long, "That token is too long."],
                [`${TOKEN}\u0000`, "That doesn&#39;t look like a token."],
                [`${TOKEN}æ`, "That doesn&#39;t look like a token."],
            ];
            for (const [value, message] of cases) {
                const res = await app.post("/admin/settings/claude-token", {claudeToken: value});
                const html = await res.text();
                expect(res.status, message).toBe(400);
                expect(html).toContain(message);
                expect(html).not.toContain(TOKEN);
            }
            expect((await app.post("/admin/settings/claude-token", {})).status).toBe(400);
            expect(setClaudeToken).not.toHaveBeenCalled();
        });

        it("answers a failure to save with a 500 that doesn't echo the token", async () => {
            setClaudeToken.mockResolvedValue(failure(AppError.DB_ERROR));

            const res = await app.post("/admin/settings/claude-token", {claudeToken: TOKEN});
            const html = await res.text();

            expect(res.status).toBe(500);
            expect(html).toContain("Something went wrong.");
            expect(html).not.toContain(TOKEN);
        });

        it("removes the token and says so, whether one was set or not", async () => {
            const res = await app.post("/admin/settings/claude-token/remove", {});

            expect(removeClaudeToken).toHaveBeenCalled();
            expect(res.headers.get("location")).toBe("/admin/settings?done=removed");
            expect(await (await app.get("/admin/settings?done=removed")).text()).toContain("Removed.");
        });

        it("answers a failure to remove with a 500", async () => {
            removeClaudeToken.mockResolvedValue(failure(AppError.DB_ERROR));

            expect((await app.post("/admin/settings/claude-token/remove", {})).status).toBe(500);
        });
    });
});
