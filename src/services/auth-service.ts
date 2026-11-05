import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type {Request, Response} from "express";
import {success, failure, type Result, type AsyncResult} from "../lib/result.js";
import type {MaybeUndefined, NodeEnv, ValueOf} from "../lib/types.js";
import type UserRepository from "../repositories/user-repository.js";
import type {User} from "../repositories/user-repository.js";
import type LoggerService from "./logger-service.js";

export interface AuthServiceOpts {
    cookieName: string;
    secret: string;
    bcryptRounds: number;
    expiryMs: number;
    mode: NodeEnv;
}

export const AuthError = {
    INVALID_CREDENTIALS: "invalid_credentials",
    UNAUTHENTICATED: "unauthenticated",
    DB_ERROR: "db_error",
    INTERNAL_ERROR: "internal_error",
} as const;

export type AuthError = ValueOf<typeof AuthError>;

const COOKIE_PATH = "/admin";

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

type AccessTokenPayload = {
    userId: string;
    tokenVersion: number;
};

function isPayload(value: unknown): value is AccessTokenPayload {
    const v = value as Partial<AccessTokenPayload>;
    return typeof v?.userId === "string" && typeof v.tokenVersion === "number";
}

class AuthService {
    constructor(
        private readonly userRepo: UserRepository,
        private readonly opts: AuthServiceOpts,
        private readonly log: LoggerService
    ) {}

    async login(email: string, password: string): AsyncResult<string, AuthError> {
        const userResult = await this.userRepo.getWithPasswordByEmail(normalizeEmail(email));
        if (!userResult.ok) return failure(AuthError.DB_ERROR);
        if (!userResult.data) return failure(AuthError.INVALID_CREDENTIALS);

        const user = userResult.data;

        const compareResult = await this.#comparePassword(password, user.password);
        if (!compareResult.ok || !compareResult.data) return failure(AuthError.INVALID_CREDENTIALS);

        return this.#issueToken(user);
    }

    async authenticate(token: MaybeUndefined<string>): AsyncResult<User, AuthError> {
        if (!token) return failure(AuthError.UNAUTHENTICATED);

        const verified = this.#verifyAccessToken(token);
        if (!verified.ok) return failure(AuthError.UNAUTHENTICATED);

        const userResult = await this.userRepo.get(verified.data.userId);
        if (!userResult.ok) return failure(AuthError.DB_ERROR);

        const user = userResult.data;
        if (!user || user.role !== "ADMIN" || user.tokenVersion !== verified.data.tokenVersion) {
            return failure(AuthError.UNAUTHENTICATED);
        }

        return success(user);
    }

    async changePassword(userId: string, currentPassword: string, newPassword: string): AsyncResult<string, AuthError> {
        const userResult = await this.userRepo.getWithPasswordById(userId);
        if (!userResult.ok) return failure(AuthError.DB_ERROR);
        if (!userResult.data) return failure(AuthError.UNAUTHENTICATED);

        const compareResult = await this.#comparePassword(currentPassword, userResult.data.password);
        if (!compareResult.ok || !compareResult.data) return failure(AuthError.INVALID_CREDENTIALS);

        const hash = await this.#hashPassword(newPassword);
        if (!hash.ok) return failure(AuthError.INTERNAL_ERROR);

        const updated = await this.userRepo.updatePassword(userId, hash.data);
        if (!updated.ok) return failure(AuthError.DB_ERROR);

        return this.#issueToken(updated.data);
    }

    async logout(userId: string): AsyncResult<void, AuthError> {
        const bumped = await this.userRepo.bumpTokenVersion(userId);
        return bumped.ok ? success(undefined) : failure(AuthError.DB_ERROR);
    }

    getToken(req: Request): MaybeUndefined<string> {
        return req.cookies?.[this.opts.cookieName];
    }

    setAuthCookies(res: Response, accessToken: string): void {
        res.cookie(this.opts.cookieName, accessToken, {
            httpOnly: true,
            secure: this.opts.mode === "production",
            // a link from another site keeps the owner signed in, and lax still holds the cookie back from
            // another site's posts
            sameSite: "lax",
            path: COOKIE_PATH,
            maxAge: this.opts.expiryMs,
        });
    }

    clearAuthCookies(res: Response): void {
        res.clearCookie(this.opts.cookieName, {path: COOKIE_PATH});
    }

    #issueToken(user: Pick<User, "id" | "tokenVersion">): Result<string, AuthError> {
        const token = this.#generateAccessToken({userId: user.id, tokenVersion: user.tokenVersion});
        return token.ok ? token : failure(AuthError.INTERNAL_ERROR);
    }

    async #hashPassword(password: string): AsyncResult<string> {
        try {
            return success(await bcrypt.hash(password, this.opts.bcryptRounds));
        } catch (err) {
            this.log.error(err, "auth-service.hashPassword");
            return failure("failed to hash password");
        }
    }

    async #comparePassword(password: string, hash: string): AsyncResult<boolean> {
        try {
            return success(await bcrypt.compare(password, hash));
        } catch (err) {
            this.log.error(err, "auth-service.comparePassword");
            return failure("failed to compare password");
        }
    }

    #generateAccessToken(payload: AccessTokenPayload): Result<string> {
        try {
            const token = jwt.sign(payload, this.opts.secret, {
                algorithm: "HS256",
                expiresIn: Math.floor(this.opts.expiryMs / 1000),
            });
            return success(token);
        } catch (err) {
            this.log.error(err, "auth-service.generateAccessToken");
            return failure("failed to generate access token");
        }
    }

    #verifyAccessToken(token: string): Result<AccessTokenPayload> {
        try {
            const payload = jwt.verify(token, this.opts.secret, {algorithms: ["HS256"]});
            if (!isPayload(payload)) return failure("malformed access token");
            return success(payload);
        } catch (err) {
            this.log.debug({err}, "auth-service.verifyAccessToken");
            return failure("invalid or expired access token");
        }
    }
}

export default AuthService;
