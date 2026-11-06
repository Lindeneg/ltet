import {Router, type Request} from "express";
import z from "zod";
import {send} from "../../lib/http.js";
import {fieldErrors} from "../../lib/validation.js";
import {getAuth} from "../../middleware/admin-auth.js";
import {failedAttemptLimiter, TOO_MANY_FAILED_ATTEMPTS} from "../../middleware/failed-attempt-limiter.js";
import {AuthError} from "../../services/auth-service.js";
import type AuthService from "../../services/auth-service.js";
import type ProposalService from "../../services/proposal-service.js";
import type ScoutRunnerService from "../../services/scout-runner-service.js";
import {SettingsView, type SettingsViewProps} from "../../ui/views/admin/settings.js";
import {SOMETHING_WENT_WRONG, adminPage, withDone} from "./respond.js";

// bcrypt only uses the first 72 bytes of a password
const PasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Required"),
        newPassword: z
            .string()
            .min(12, "Use at least 12 characters")
            .refine(
                (password) => Buffer.byteLength(password, "utf8") <= 72,
                "Use at most 72 bytes (letters like æøå count as 2)"
            ),
        confirmPassword: z.string(),
    })
    .refine((p) => p.newPassword === p.confirmPassword, {path: ["confirmPassword"], message: "Passwords don't match"});

const BAD_SCOUT_TIME = "Use a time like 06:00.";

const ScoutTimeSchema = z.object({scoutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)});

const EMPTY_TOKEN = "Paste the token.";
const LONG_TOKEN = "That token is too long.";
const MAX_TOKEN_LENGTH = 4096;

const currentPath = "/admin/settings";

export function settingsRouter(
    authService: AuthService,
    proposalService: ProposalService,
    scoutRunner: ScoutRunnerService
): Router {
    const router = Router();

    const view = async (req: Request, props: Omit<SettingsViewProps, "page"> = {}) => {
        const time = await scoutRunner.scoutTime();
        const token = await scoutRunner.claudeToken();
        return SettingsView({
            page: await adminPage(req, proposalService, "settings"),
            scoutTime: time.ok ? time.data : "",
            token: token.ok ? token.data : null,
            ...props,
        });
    };

    const passwordLimiter = failedAttemptLimiter(async (req, res) => {
        send(res, await view(req, {passwordTopError: TOO_MANY_FAILED_ATTEMPTS}), 429);
    });

    router.get("/settings", async (req, res) => {
        send(res, await view(req, {passwordChanged: req.query.password === "changed"}));
    });

    router.post("/settings/password", passwordLimiter, async (req, res) => {
        const parsed = PasswordSchema.safeParse(req.body);
        if (!parsed.success) return send(res, await view(req, {passwordErrors: fieldErrors(parsed.error)}), 400);

        const {currentPassword, newPassword} = parsed.data;
        const result = await authService.changePassword(getAuth(req).id, currentPassword, newPassword);
        if (!result.ok) {
            if (result.ctx === AuthError.INVALID_CREDENTIALS) {
                return send(res, await view(req, {passwordErrors: {currentPassword: "Wrong password"}}), 401);
            }
            return send(res, await view(req, {passwordTopError: "Failed to change password"}), 500);
        }
        // the change revoked the old cookie's token, so this session gets a fresh one
        authService.setAuthCookies(res, result.data);
        res.redirect(302, `${currentPath}?password=changed`);
    });

    router.post("/settings/scout", async (req, res) => {
        const parsed = ScoutTimeSchema.safeParse(req.body);
        if (!parsed.success) {
            const scoutTime = typeof req.body?.scoutTime === "string" ? req.body.scoutTime : "";
            return send(res, await view(req, {scoutTime, scoutError: BAD_SCOUT_TIME}), 400);
        }
        const saved = await scoutRunner.setScoutTime(parsed.data.scoutTime);
        if (!saved.ok) return send(res, await view(req, {scoutError: SOMETHING_WENT_WRONG}), 500);
        res.redirect(302, withDone(currentPath, "saved"));
    });

    router.post("/settings/claude-token", async (req, res) => {
        const token = typeof req.body?.claudeToken === "string" ? req.body.claudeToken.replace(/\s+/g, "") : "";
        if (!token) return send(res, await view(req, {tokenError: EMPTY_TOKEN}), 400);
        if (token.length > MAX_TOKEN_LENGTH) return send(res, await view(req, {tokenError: LONG_TOKEN}), 400);
        const saved = await scoutRunner.setClaudeToken(token);
        if (!saved.ok) return send(res, await view(req, {tokenError: SOMETHING_WENT_WRONG}), 500);
        res.redirect(302, withDone(currentPath, "saved"));
    });

    router.post("/settings/claude-token/remove", async (req, res) => {
        const removed = await scoutRunner.removeClaudeToken();
        if (!removed.ok) return send(res, await view(req, {tokenError: SOMETHING_WENT_WRONG}), 500);
        res.redirect(302, withDone(currentPath, "removed"));
    });

    return router;
}
