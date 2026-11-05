import type {ValueOf} from "./types.js";

export const AppError = {
    NOT_FOUND: "not_found",
    CONFLICT: "conflict",
    INVALID: "invalid",
    DB_ERROR: "db_error",
} as const;

export type AppError = ValueOf<typeof AppError>;

export type DbError = typeof AppError.NOT_FOUND | typeof AppError.CONFLICT | typeof AppError.DB_ERROR;
