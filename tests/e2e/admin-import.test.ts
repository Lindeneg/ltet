import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {readSeed, type RawStatement} from "../../src/lib/content.js";
import {MAX_FORM_BYTES, MAX_IMPORT_FORM_BYTES} from "../../src/lib/http.js";
import {SkipReason} from "../../src/lib/statement-import.js";
import StatementRepository from "../../src/repositories/statement-repository.js";
import {IMPORT_NOTE} from "../../src/services/statement-service.js";
import {db, get, login, postForm, uid} from "./helpers.js";

const PREFIX = `altman-2026-01-03-import-${uid()}`;
const statements = new StatementRepository(db);
let cookie: string;
let seed: RawStatement[];

beforeAll(async () => {
    cookie = await login();
    seed = await readSeed();
});

afterAll(async () => {
    await db.p.statement.deleteMany({where: {id: {startsWith: PREFIX}}});
});

async function hidden(): Promise<RawStatement> {
    const id = `${PREFIX}-${uid()}`;
    const body: RawStatement = {...seed[0], id, ceo: "altman", date: "2026-01-03", venue: "A first venue"};
    await db.p.statement.create({
        data: {id, ceo: body.ceo, date: body.date, body: JSON.stringify(body), published: false, origin: "seed"},
    });
    return body;
}

const row = (id: string) => db.p.statement.findUniqueOrThrow({where: {id}, include: {history: true}});

const venueEdit = (id: string, from: string, to: string) => ({id, set: {venue: {from, to}}});

describe("the bulk import", () => {
    it("is linked from the statements list", async () => {
        const res = await get("/admin/statements", cookie);
        expect(res.html).toContain('href="/admin/import"');
    });

    it("needs a login and a same-origin post", async () => {
        expect((await get("/admin/import")).status).toBe(302);
        const target = await hidden();
        const write = JSON.stringify({edits: [venueEdit(target.id, "A first venue", "Anonymous")]});
        const anonymous = await postForm("/admin/import/apply", {edits: write});
        expect(anonymous.status).toBe(302);
        expect(anonymous.location).toContain("/admin/login");
        expect(JSON.parse((await row(target.id)).body).venue).toBe("A first venue");
        const file = JSON.stringify({edits: [venueEdit("x", "a", "b")]});
        const res = await postForm("/admin/import/apply", {edits: file}, cookie, {origin: "https://elsewhere.example"});
        expect(res.status).toBe(403);
    });

    it("previews without writing, applies, and finds everything stale on a second apply", async () => {
        const good = await hidden();
        const bad = await hidden();
        const file = JSON.stringify({
            edits: [
                venueEdit(good.id, "A first venue", "A shorter venue"),
                {id: bad.id, set: {venue: {from: "A first venue", to: "B"}, "scores.loss.score": {from: 99, to: 1}}},
                venueEdit(`${PREFIX}-missing`, "a", "b"),
            ],
        });

        const preview = await postForm("/admin/import/preview", {edits: file}, cookie);
        expect(preview.status).toBe(200);
        expect(preview.html).toContain("1 statement will change, 2 skipped, 0 unchanged.");
        expect(preview.html).toContain(SkipReason.STALE);
        expect(preview.html).toContain(SkipReason.UNKNOWN_ID);
        expect(JSON.parse((await row(good.id)).body).venue).toBe("A first venue");

        const applied = await postForm("/admin/import/apply", {edits: file}, cookie);
        expect(applied.status).toBe(200);
        expect(applied.html).toContain("Applied to 1 statement.");

        const written = await row(good.id);
        expect(JSON.parse(written.body).venue).toBe("A shorter venue");
        expect(written.published).toBe(false);
        expect(written.history).toHaveLength(1);
        expect(written.history[0].note).toBe(IMPORT_NOTE);
        expect(JSON.parse(written.history[0].body).venue).toBe("A first venue");

        const untouched = await row(bad.id);
        expect(JSON.parse(untouched.body).venue).toBe("A first venue");
        expect(untouched.history).toHaveLength(0);

        const again = await postForm("/admin/import/apply", {edits: file}, cookie);
        expect(again.html).toContain("Applied to 0 statements.");
        expect((await row(good.id)).history).toHaveLength(1);
    });

    it("accepts a file larger than the other forms allow", async () => {
        const target = await hidden();
        const long = "x".repeat(MAX_FORM_BYTES);
        const file = JSON.stringify({edits: [venueEdit(target.id, "A first venue", "A first venue")], pad: long});
        const res = await postForm("/admin/import/preview", {edits: file}, cookie);
        expect(res.status).toBe(200);
        expect(res.html).toContain("0 statements will change, 0 skipped, 1 unchanged.");
    });

    it("refuses a body over the import form's limit", async () => {
        const res = await postForm("/admin/import/preview", {edits: "x".repeat(MAX_IMPORT_FORM_BYTES + 1)}, cookie);
        expect(res.status).toBe(413);
    });

    it("refuses a large body before a login", async () => {
        const res = await postForm("/admin/import/preview", {edits: "x".repeat(MAX_FORM_BYTES * 2)});
        expect(res.status).toBe(302);
    });

    it("shows a form error for a file over 2 MB", async () => {
        const res = await postForm(
            "/admin/import/preview",
            {edits: `{"pad": "${"x".repeat(2 * 1024 * 1024)}"}`},
            cookie
        );
        expect(res.status).toBe(422);
        expect(res.html).toContain("The file is larger than 2 MB.");
    });
});

describe("replaceMany", () => {
    it("skips a statement changed since it was read and writes the rest", async () => {
        const first = await hidden();
        const second = await hidden();
        const read = await row(first.id);
        const readSecond = await row(second.id);
        await statements.setPublished(first.id, false, "changed meanwhile");

        const result = await statements.replaceMany(
            [
                {body: {...first, venue: "Late"}, updatedAt: read.updatedAt},
                {body: {...second, venue: "On time"}, updatedAt: readSecond.updatedAt},
            ],
            IMPORT_NOTE
        );

        expect(result).toEqual({ok: true, data: [second.id]});
        expect(JSON.parse((await row(first.id)).body).venue).toBe("A first venue");
        expect(JSON.parse((await row(second.id)).body).venue).toBe("On time");
    });
});
