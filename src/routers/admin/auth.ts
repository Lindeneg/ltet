import {Router} from "express";
import z from "zod";
import {send} from "../../lib/http.js";
import {optStr} from "../../lib/validation.js";
import {getAuth} from "../../middleware/admin-auth.js";
import {failedAttemptLimiter, TOO_MANY_FAILED_ATTEMPTS} from "../../middleware/failed-attempt-limiter.js";
import {AuthError} from "../../services/auth-service.js";
import type AuthService from "../../services/auth-service.js";
import {LoginView} from "../../ui/views/admin/login.js";
import {SOMETHING_WENT_WRONG} from "./respond.js";

const LoginSchema = z.object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1),
});

const WRONG = "Wrong email or password.";

export const FAILED_LOGIN_FLOOR_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function loginRouter(authService: AuthService, failedLoginFloorMs = FAILED_LOGIN_FLOOR_MS): Router {
    const router = Router();

    const loginLimiter = failedAttemptLimiter((req, res) => {
        send(res, LoginView({error: TOO_MANY_FAILED_ATTEMPTS, email: optStr(req.body?.email)}), 429);
    });

    router.get("/login", (_req, res) => {
        send(res, LoginView({}));
    });

    router.post("/login", loginLimiter, async (req, res) => {
        const started = Date.now();
        const parsed = LoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return send(res, LoginView({error: WRONG, email: optStr(req.body?.email)}), 400);
        }
        const result = await authService.login(parsed.data.email, parsed.data.password);
        if (!result.ok) {
            const wrong = result.ctx === AuthError.INVALID_CREDENTIALS;
            if (wrong) await sleep(failedLoginFloorMs - (Date.now() - started));
            return send(
                res,
                LoginView({error: wrong ? WRONG : SOMETHING_WENT_WRONG, email: parsed.data.email}),
                wrong ? 401 : 500
            );
        }
        authService.setAuthCookies(res, result.data);
        res.redirect(302, "/admin");
    });

    return router;
}

export function logoutRouter(authService: AuthService): Router {
    const router = Router();
    router.post("/logout", async (req, res) => {
        await authService.logout(getAuth(req).id);
        authService.clearAuthCookies(res);
        res.redirect(302, "/admin/login");
    });
    return router;
}
