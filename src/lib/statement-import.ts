import {isDeepStrictEqual} from "node:util";
import type {Ceo, RawStatement, Rubric} from "./content.js";
import {failure, success, type Result} from "./result.js";
import {statementErrors} from "./statement-rules.js";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_EDITS = 500;

export type ImportEdit = {id: string; set: Record<string, {from: unknown; to: unknown}>};

export type ImportChange = {path: string; from: unknown; to: unknown};

export type ImportReady = {id: string; updatedAt: Date; body: RawStatement; changes: ImportChange[]};

export type ImportSkip = {id: string; reasons: {path?: string; reason: string}[]};

export type ImportPlan = {ready: ImportReady[]; unchanged: string[]; skipped: ImportSkip[]};

export type LiveStatement = {id: string; updatedAt: Date; body: RawStatement};

export const SkipReason = {
    UNKNOWN_ID: "no statement has this id",
    REPEATED_ID: "the id appears more than once in the file",
    UNKNOWN_PATH: "no such path in the statement",
    ID_PATH: "the id cannot change",
    OVERLAP: "overlaps another path in the same edit",
    STALE: "from does not match the live value, it was edited since",
    CHANGED: "the statement changed during the import",
} as const;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export function parseImport(text: string): Result<ImportEdit[], string> {
    if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) return failure("The file is larger than 2 MB.");
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return failure("The file is not valid JSON.");
    }
    if (!isObject(value) || !Array.isArray(value.edits)) return failure('The file needs an "edits" list.');
    if (value.edits.length === 0) return failure("The edits list is empty.");
    if (value.edits.length > MAX_IMPORT_EDITS) return failure(`At most ${MAX_IMPORT_EDITS} edits per import.`);
    for (const [i, edit] of value.edits.entries()) {
        const at = `edits[${i}]`;
        if (!isObject(edit) || typeof edit.id !== "string") return failure(`${at} needs an "id" text.`);
        if (!isObject(edit.set) || Object.keys(edit.set).length === 0) {
            return failure(`${at} needs a "set" with at least one path.`);
        }
        for (const [path, change] of Object.entries(edit.set)) {
            if (!isObject(change) || !Object.hasOwn(change, "from") || !Object.hasOwn(change, "to")) {
                return failure(`${at}.set["${path}"] needs "from" and "to".`);
            }
        }
    }
    return success(value.edits as ImportEdit[]);
}

function has(node: unknown, key: string): boolean {
    if (Array.isArray(node)) return /^\d+$/.test(key) && Number(key) < node.length;
    return isObject(node) && Object.hasOwn(node, key);
}

function walk(node: unknown, [key, ...rest]: string[]): {parent: Record<string, unknown>; key: string} | null {
    if (!has(node, key)) return null;
    const parent = node as Record<string, unknown>;
    return rest.length === 0 ? {parent, key} : walk(parent[key], rest);
}

export function locate(body: unknown, path: string): {parent: Record<string, unknown>; key: string} | null {
    const keys = path.split(".");
    if (keys.some((key) => key === "" || FORBIDDEN.has(key))) return null;
    return walk(body, keys);
}

const overlaps = (path: string, paths: string[]) =>
    paths.some((other) => other.startsWith(`${path}.`) || path.startsWith(`${other}.`));

function planOne(
    edit: ImportEdit,
    live: LiveStatement,
    rules: {ceos: Ceo[]; rubric: Rubric}
): ImportReady | ImportSkip | null {
    const body = structuredClone(live.body);
    const paths = Object.keys(edit.set);
    const reasons: ImportSkip["reasons"] = [];
    const changes: ImportChange[] = [];
    for (const path of paths) {
        const {from, to} = edit.set[path];
        const spot = locate(body, path);
        if (path === "id") reasons.push({path, reason: SkipReason.ID_PATH});
        else if (!spot) reasons.push({path, reason: SkipReason.UNKNOWN_PATH});
        else if (overlaps(path, paths)) reasons.push({path, reason: SkipReason.OVERLAP});
        else if (!isDeepStrictEqual(spot.parent[spot.key], from)) {
            reasons.push({path, reason: SkipReason.STALE});
        } else if (!isDeepStrictEqual(from, to)) {
            spot.parent[spot.key] = to;
            changes.push({path, from, to});
        }
    }
    if (reasons.length > 0) return {id: edit.id, reasons};
    if (changes.length === 0) return null;
    const errors = statementErrors(body, rules);
    if (errors.length > 0) return {id: edit.id, reasons: errors.map((reason) => ({reason}))};
    return {id: edit.id, updatedAt: live.updatedAt, body, changes};
}

export function planImport(
    edits: ImportEdit[],
    live: Map<string, LiveStatement>,
    rules: {ceos: Ceo[]; rubric: Rubric}
): ImportPlan {
    const plan: ImportPlan = {ready: [], unchanged: [], skipped: []};
    const counts = new Map<string, number>();
    for (const edit of edits) counts.set(edit.id, (counts.get(edit.id) ?? 0) + 1);
    const seen = new Set<string>();
    for (const edit of edits) {
        if (seen.has(edit.id)) continue;
        seen.add(edit.id);
        const statement = live.get(edit.id);
        if ((counts.get(edit.id) ?? 0) > 1) {
            plan.skipped.push({id: edit.id, reasons: [{reason: SkipReason.REPEATED_ID}]});
        } else if (!statement) {
            plan.skipped.push({id: edit.id, reasons: [{reason: SkipReason.UNKNOWN_ID}]});
        } else {
            const result = planOne(edit, statement, rules);
            if (!result) plan.unchanged.push(edit.id);
            else if ("reasons" in result) plan.skipped.push(result);
            else plan.ready.push(result);
        }
    }
    return plan;
}
