import {
    unwrap,
    loadEnv,
    toString,
    toInt,
    toEnum,
    withRequired,
    withDefault,
    failure,
    success,
    refine,
    nonEmpty,
    minLength,
    inRange,
    withOptional,
} from "@lindeneg/cl-env";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isInTestMode(): boolean {
    return process.env.NODE_ENV === "test";
}

export function envFiles(): string[] {
    return isInTestMode() ? [".env.test"] : [".env", ".env.default", ".env.local", ".env.prod"];
}

// a password may hold commas
export function parseSuperUser(value: string) {
    const [rawEmail, firstName, lastName, ...rest] = value.split(",");
    const email = rawEmail?.trim().toLowerCase();
    const password = rest.join(",");
    if (!email || !firstName || !lastName || !password) {
        return failure("must be email,firstname,lastname,password");
    }
    // bcrypt reads only the first 72 bytes of a password
    if (Buffer.byteLength(password, "utf8") > 72) {
        return failure("Use at most 72 bytes (letters like æøå count as 2)");
    }
    return success({email, name: `${firstName} ${lastName}`, password});
}

export function parsePublicUrl(_: string, value: string | undefined) {
    if (value === undefined || value.trim() === "") return success(undefined);
    const invalid = failure("must be an absolute url like https://example.com");
    if (!URL.canParse(value)) return invalid;
    if (!/^https?:$/.test(new URL(value).protocol)) return invalid;
    return success(value.trim().replace(/\/+$/, ""));
}

function optionalSuperUser(_: string, value: string | undefined) {
    if (value === undefined) return success(undefined);
    return parseSuperUser(value);
}

const options = {
    files: [] as string[],
    optionalFiles: envFiles(),
    includeProcessEnv: "override" as const,
    transformKeys: false as const,
};

const readByTheSeedsAndTheScout = () => success(undefined);

export function loadAppEnv() {
    return unwrap(
        loadEnv(
            {...options, logger: true},
            {
                DATABASE_URL: withRequired(refine(toString(), nonEmpty())),
                JWT_SECRET: withRequired(refine(toString(), minLength(32))),
                NODE_ENV: withRequired(toEnum("test", "development", "production")),

                PORT: withDefault(toInt(), 3000),
                JWT_EXPIRE_MS: withDefault(toInt(), THIRTY_DAYS_MS),
                JWT_COOKIE_NAME: withDefault(toString(), "ltet_admin"),
                BCRYPT_ROUNDS: withDefault(refine(toInt(), inRange(4, 12)), 12),

                PUBLIC_URL: parsePublicUrl,
                LOG_LEVEL: withOptional(toEnum("fatal", "error", "warn", "info", "debug", "trace", "silent")),

                TRUST_PROXY: function (_, value) {
                    if (value === undefined || value.trim() === "") return success("loopback");
                    return success(/^\d+$/.test(value) ? Number(value) : value);
                },

                SUPER_USER: readByTheSeedsAndTheScout,
                SCOUT_MODEL: readByTheSeedsAndTheScout,
                CLAUDE_BIN: readByTheSeedsAndTheScout,
            }
        )
    );
}

export type AppEnv = ReturnType<typeof loadAppEnv>;

export function loadSeedEnv() {
    return unwrap(
        loadEnv(options, {
            DATABASE_URL: withRequired(refine(toString(), nonEmpty())),
            NODE_ENV: withRequired(toEnum("test", "development", "production")),
            BCRYPT_ROUNDS: withDefault(refine(toInt(), inRange(4, 12)), 12),
            SUPER_USER: optionalSuperUser,
        })
    );
}

export function loadScoutEnv() {
    return unwrap(
        loadEnv(options, {
            DATABASE_URL: withRequired(refine(toString(), nonEmpty())),
            SCOUT_MODEL: withDefault(refine(toString(), nonEmpty()), "opus"),
            CLAUDE_BIN: withDefault(refine(toString(), nonEmpty()), "claude"),
        })
    );
}
