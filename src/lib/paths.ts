import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// src/lib and dist/lib sit at the same depth, so these resolve the same from both
const root = new URL("../../", import.meta.url);

export const ROOT_DIR = fileURLToPath(root);
export const PUBLIC_DIR = fileURLToPath(new URL("public/", root));
export const DATA_FILES_DIR = fileURLToPath(new URL("prisma/seed/", root));
export const PROMPTS_DIR = fileURLToPath(new URL("prompts/", root));
export const SEED_PHOTOS_DIR = fileURLToPath(new URL("prisma/seed/photos/", root));

export function databaseDir(databaseUrl: string): string {
    return resolve(dirname(databaseUrl.replace(/^file:/, "")));
}

export function photosDir(databaseUrl: string): string {
    return join(databaseDir(databaseUrl), "photos");
}
