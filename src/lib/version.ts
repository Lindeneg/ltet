import {readFileSync} from "node:fs";
import {z} from "zod";
import type {MaybeNull} from "./types.js";

const versionSchema = z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/),
    date: z.iso.datetime(),
    dirty: z.boolean(),
});

export type Version = z.infer<typeof versionSchema>;

export function parseVersion(text: string): MaybeNull<Version> {
    try {
        const parsed = versionSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export function readVersion(file: URL | string): MaybeNull<Version> {
    try {
        return parseVersion(readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

// written into dist by the build, so a run from src has none
export const VERSION = readVersion(new URL("../version.json", import.meta.url));
