import {describe, expect, it} from "vitest";
import {
    MAX_IMPORT_BYTES,
    MAX_IMPORT_EDITS,
    SkipReason,
    locate,
    parseImport,
    planImport,
    type ImportEdit,
    type LiveStatement,
} from "../../../src/lib/statement-import.js";
import {makeContent, makeStatement} from "../helpers.js";

const id = makeStatement().id;
const updatedAt = new Date("2025-09-02T10:00:00Z");
const rules = makeContent();

function live(...bodies: ReturnType<typeof makeStatement>[]): Map<string, LiveStatement> {
    const all = bodies.length > 0 ? bodies : [makeStatement()];
    return new Map(all.map((body) => [body.id, {id: body.id, updatedAt, body}]));
}

const edit = (set: ImportEdit["set"], editId = id): ImportEdit => ({id: editId, set});

const text = (edits: unknown) => JSON.stringify({edits});

describe("parseImport", () => {
    it("reads a valid file", () => {
        const edits = [edit({venue: {from: "An interview", to: "A podcast"}})];
        expect(parseImport(text(edits))).toEqual({ok: true, data: edits});
    });

    it("rejects invalid JSON", () => {
        expect(parseImport("{edits: [")).toEqual({ok: false, ctx: "The file is not valid JSON."});
    });

    it.each([
        ["no edits list", {}, 'The file needs an "edits" list.'],
        ["edits not a list", {edits: {}}, 'The file needs an "edits" list.'],
        ["a list at the top", [], 'The file needs an "edits" list.'],
        ["an entry without id", {edits: [{set: {venue: {from: 1, to: 2}}}]}, 'edits[0] needs an "id" text.'],
        ["an id that is not text", {edits: [{id: 1, set: {venue: {from: 1, to: 2}}}]}, 'edits[0] needs an "id" text.'],
        ["an entry without set", {edits: [{id}]}, 'edits[0] needs a "set" with at least one path.'],
        ["a path without from", {edits: [{id, set: {venue: {to: 2}}}]}, 'edits[0].set["venue"] needs "from" and "to".'],
        ["a path without to", {edits: [{id, set: {venue: {from: 1}}}]}, 'edits[0].set["venue"] needs "from" and "to".'],
        [
            "a change that is not an object",
            {edits: [{id, set: {venue: "x"}}]},
            'edits[0].set["venue"] needs "from" and "to".',
        ],
    ])("rejects wrong shape, %s", (_name, value, message) => {
        expect(parseImport(JSON.stringify(value))).toEqual({ok: false, ctx: message});
    });

    it("accepts null as from or to", () => {
        expect(parseImport(text([edit({primarySource: {from: null, to: null}})])).ok).toBe(true);
    });

    it("rejects an empty list", () => {
        expect(parseImport(text([]))).toEqual({ok: false, ctx: "The edits list is empty."});
    });

    it("rejects an empty set", () => {
        expect(parseImport(text([edit({})]))).toEqual({
            ok: false,
            ctx: 'edits[0] needs a "set" with at least one path.',
        });
    });

    it("limits the number of edits, at and over", () => {
        const one = edit({venue: {from: "a", to: "b"}});
        expect(parseImport(text(Array.from({length: MAX_IMPORT_EDITS}, () => one))).ok).toBe(true);
        expect(parseImport(text(Array.from({length: MAX_IMPORT_EDITS + 1}, () => one)))).toEqual({
            ok: false,
            ctx: "At most 500 edits per import.",
        });
    });

    it("limits the bytes, at and over", () => {
        const base = text([edit({venue: {from: "a", to: ""}})]);
        const padded = (n: number) => base.replace('"to":""', `"to":"${"a".repeat(n)}"`);
        const room = MAX_IMPORT_BYTES - Buffer.byteLength(base);
        expect(Buffer.byteLength(padded(room))).toBe(MAX_IMPORT_BYTES);
        expect(parseImport(padded(room)).ok).toBe(true);
        expect(parseImport(padded(room + 1))).toEqual({ok: false, ctx: "The file is larger than 2 MB."});
        expect(parseImport(padded(room - 1) + "é")).toEqual({ok: false, ctx: "The file is larger than 2 MB."});
    });
});

describe("locate", () => {
    const body = makeStatement();

    it("finds nested keys and array indices", () => {
        expect(locate(body, "scores.loss.score")).toEqual({parent: body.scores.loss, key: "score"});
        expect(locate(body, "sources.1.url")).toEqual({parent: body.sources[1], key: "url"});
    });

    it.each([
        "nope",
        "venue.length",
        "scores.nope.score",
        "sources.2.url",
        "sources.length",
        "sources.-1",
        "sources.01x",
        "",
        "scores..loss",
        "scores.",
        "__proto__",
        "scores.__proto__",
        "constructor",
        "scores.constructor.prototype",
        "prototype",
        "scores.prototype",
        "scores.loss.constructor",
        "toString",
        "hasOwnProperty",
    ])("refuses %j", (path) => {
        expect(locate(body, path)).toBeNull();
    });
});

describe("planImport", () => {
    it("plans a change with its before and after", () => {
        const plan = planImport(
            [edit({venue: {from: "An interview", to: "A podcast"}, "scores.loss.score": {from: 3, to: 4}})],
            live(),
            rules
        );
        expect(plan.skipped).toEqual([]);
        expect(plan.unchanged).toEqual([]);
        expect(plan.ready).toHaveLength(1);
        expect(plan.ready[0].updatedAt).toBe(updatedAt);
        expect(plan.ready[0].body.venue).toBe("A podcast");
        expect(plan.ready[0].body.scores.loss.score).toBe(4);
        expect(plan.ready[0].changes).toEqual([
            {path: "venue", from: "An interview", to: "A podcast"},
            {path: "scores.loss.score", from: 3, to: 4},
        ]);
    });

    it("never changes the live statement", () => {
        const statements = live();
        planImport([edit({venue: {from: "An interview", to: "A podcast"}})], statements, rules);
        expect(statements.get(id)?.body.venue).toBe("An interview");
    });

    it("skips an unknown id", () => {
        const plan = planImport([edit({venue: {from: "a", to: "b"}}, "nobody-2025-01-01-x")], live(), rules);
        expect(plan.skipped).toEqual([{id: "nobody-2025-01-01-x", reasons: [{reason: SkipReason.UNKNOWN_ID}]}]);
        expect(plan.ready).toEqual([]);
    });

    it("skips unknown paths and never creates a key", () => {
        const plan = planImport(
            [edit({"scores.loss.weight": {from: 1, to: 2}, nope: {from: 1, to: 2}})],
            live(),
            rules
        );
        expect(plan.skipped).toEqual([
            {
                id,
                reasons: [
                    {path: "scores.loss.weight", reason: SkipReason.UNKNOWN_PATH},
                    {path: "nope", reason: SkipReason.UNKNOWN_PATH},
                ],
            },
        ]);
    });

    it.each(["__proto__", "prototype", "constructor"])("skips %s as any segment and writes nothing", (segment) => {
        const paths = [segment, `scores.${segment}`, `scores.loss.${segment}`, `${segment}.polluted`];
        const set = Object.fromEntries(paths.map((path) => [path, {from: {}, to: {polluted: true}}]));
        const plan = planImport([edit(set)], live(), rules);
        expect(plan.ready).toEqual([]);
        expect(plan.skipped[0].reasons).toEqual(paths.map((path) => ({path, reason: SkipReason.UNKNOWN_PATH})));
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    });

    it("never touches the prototype", () => {
        const set = JSON.parse('{"__proto__": {"from": {}, "to": {"polluted": true}}}');
        const plan = planImport([edit(set)], live(), rules);
        expect(plan.skipped[0].reasons).toEqual([{path: "__proto__", reason: SkipReason.UNKNOWN_PATH}]);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("skips the id path", () => {
        const plan = planImport([edit({id: {from: id, to: "altman-2025-09-01-other"}})], live(), rules);
        expect(plan.skipped).toEqual([{id, reasons: [{path: "id", reason: SkipReason.ID_PATH}]}]);
    });

    it("skips a stale edit", () => {
        const plan = planImport([edit({venue: {from: "A speech", to: "A podcast"}})], live(), rules);
        expect(plan.skipped).toEqual([{id, reasons: [{path: "venue", reason: SkipReason.STALE}]}]);
    });

    it("plans through an array index", () => {
        const plan = planImport(
            [edit({"sources.1.url": {from: "https://two.example/b", to: "https://two.example/c"}})],
            live(),
            rules
        );
        expect(plan.ready[0].body.sources[1].url).toBe("https://two.example/c");
    });

    it("compares objects deeply for from", () => {
        const from = {summary: "People were upset.", url: "https://two.example/b"};
        const to = {summary: "Many were upset.", url: "https://two.example/b"};
        const plan = planImport([edit({backlash: {from, to}})], live(), rules);
        expect(plan.ready[0].body.backlash).toEqual(to);
    });

    it("skips an invalid result with the rule's errors", () => {
        const plan = planImport([edit({"scores.loss.score": {from: 3, to: 9}})], live(), rules);
        expect(plan.skipped).toEqual([{id, reasons: [{reason: "score for loss must be an integer from 0 to 5"}]}]);
        expect(plan.ready).toEqual([]);
    });

    it("treats a no-op as no change", () => {
        const plan = planImport(
            [edit({venue: {from: "An interview", to: "An interview"}, context: {from: "Some context.", to: "New."}})],
            live(),
            rules
        );
        expect(plan.ready[0].changes).toEqual([{path: "context", from: "Some context.", to: "New."}]);
    });

    it("lists a statement whose every edit is a no-op as unchanged", () => {
        const plan = planImport([edit({venue: {from: "An interview", to: "An interview"}})], live(), rules);
        expect(plan).toEqual({ready: [], unchanged: [id], skipped: []});
    });

    it("skips a repeated id as a whole", () => {
        const plan = planImport(
            [edit({venue: {from: "An interview", to: "A"}}), edit({context: {from: "Some context.", to: "B"}})],
            live(),
            rules
        );
        expect(plan).toEqual({ready: [], unchanged: [], skipped: [{id, reasons: [{reason: SkipReason.REPEATED_ID}]}]});
    });

    it("skips overlapping paths", () => {
        const plan = planImport(
            [
                edit({
                    "scores.loss": {from: {score: 3, reason: "A reason."}, to: {score: 2, reason: "A reason."}},
                    "scores.loss.score": {from: 3, to: 4},
                }),
            ],
            live(),
            rules
        );
        expect(plan.skipped).toEqual([
            {
                id,
                reasons: [
                    {path: "scores.loss", reason: SkipReason.OVERLAP},
                    {path: "scores.loss.score", reason: SkipReason.OVERLAP},
                ],
            },
        ]);
    });

    it("leaves a statement with one bad edit untouched and plans the others", () => {
        const other = makeStatement({id: "musk-2025-01-01-other", ceo: "musk"});
        const plan = planImport(
            [
                edit({venue: {from: "An interview", to: "A podcast"}, context: {from: "Stale.", to: "New."}}),
                edit({venue: {from: "An interview", to: "A speech"}}, other.id),
            ],
            live(makeStatement(), other),
            rules
        );
        expect(plan.skipped).toEqual([{id, reasons: [{path: "context", reason: SkipReason.STALE}]}]);
        expect(plan.ready.map((item) => item.id)).toEqual([other.id]);
    });

    it("finds every edit stale once applied", () => {
        const edits = [edit({venue: {from: "An interview", to: "A podcast"}})];
        const after = planImport(edits, live(), rules).ready[0].body;
        expect(planImport(edits, live(after), rules).skipped).toEqual([
            {id, reasons: [{path: "venue", reason: SkipReason.STALE}]},
        ]);
    });
});
