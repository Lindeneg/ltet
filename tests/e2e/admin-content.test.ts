import {existsSync} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {LEVELS, loadContent, readSeed} from "../../src/lib/content.js";
import {photosDir, SEED_PHOTOS_DIR} from "../../src/lib/paths.js";
import {BASE_URL, db, env, get, login, postForm, uid} from "./helpers.js";

const JPEG = await readFile(join(SEED_PHOTOS_DIR, "altman.jpg"));
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("starts like a jpeg and is not one")]);
const store = photosDir(env.DATABASE_URL);

let cookie: string;
const created: string[] = [];

type Fields = Record<string, string>;

async function postMultipart(path: string, fields: Fields, photo?: {data: Buffer; type: string; name: string}) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    if (photo) form.append("photo", new Blob([new Uint8Array(photo.data)], {type: photo.type}), photo.name);
    const res = await fetch(BASE_URL + path, {
        method: "POST",
        body: form,
        headers: {cookie, origin: BASE_URL},
        redirect: "manual",
    });
    return {status: res.status, location: res.headers.get("location"), html: await res.text()};
}

const credits = {
    photoAuthor: "A Photographer",
    photoLicence: "CC BY 4.0",
    photoLicenceUrl: "https://creativecommons.org/licenses/by/4.0",
    photoSource: "https://commons.wikimedia.org/wiki/File:Test.jpg",
    photoChanges: "cropped",
};

function newId() {
    const id = `test-${uid()}`;
    created.push(id);
    return id;
}

beforeAll(async () => {
    cookie = await login();
});

afterAll(async () => {
    for (const id of created) await postForm(`/admin/contenders/${id}/delete`, {}, cookie);
});

describe("the contenders in the cms", () => {
    it("lists every contender with its statement count", async () => {
        const {ceos} = await loadContent();
        const altman = await db.p.statement.count({where: {ceo: "altman"}});

        const res = await get("/admin/contenders", cookie);

        expect(res.status).toBe(200);
        for (const ceo of ceos) expect(res.html).toContain(ceo.name);
        expect(res.html).toContain(`<td data-label="Statements" class="num">${altman}</td>`);
        expect(res.html).toContain(`href="/admin/contenders/new">New contender</a>`);
    });

    it("adds a contender without a photo, last in the table", async () => {
        const id = newId();

        const res = await postMultipart("/admin/contenders", {id, name: "Test Person", company: "Test Co"});

        expect(res.status).toBe(302);
        expect(res.location).toBe(`/admin/contenders/${id}?done=added`);
        expect((await get(res.location!, cookie)).html).toContain("Added.");
        expect((await get(`/club/${id}`)).status).toBe(200);
        const rows = await db.p.contender.findMany({orderBy: {position: "asc"}});
        expect(rows.at(-1)?.id).toBe(id);
    });

    it("adds a contender with a photo, serves it and credits it on the rules page", async () => {
        const id = newId();

        const res = await postMultipart(
            "/admin/contenders",
            {id, name: "Photo Person", company: "Test Co", ...credits},
            {data: JPEG, type: "image/jpeg", name: "face.jpg"}
        );

        expect(res.status).toBe(302);
        const photo = await fetch(`${BASE_URL}/assets/ceos/${id}.jpg`);
        expect(photo.status).toBe(200);
        expect(Buffer.from(await photo.arrayBuffer())).toEqual(JPEG);
        const rules = await get("/rules");
        expect(rules.html).toContain("<strong>Photo Person</strong>");
        expect(rules.html).toContain("A Photographer");
    });

    it("refuses a photo that isn't a JPEG, keeping what was typed", async () => {
        const id = newId();

        const res = await postMultipart(
            "/admin/contenders",
            {id, name: "Png Person", company: "Test Co", ...credits},
            {data: Buffer.from("\x89PNG not a jpeg"), type: "image/jpeg", name: "face.jpg"}
        );

        expect(res.status).toBe(400);
        expect(res.html).toContain("Upload a JPEG");
        expect(res.html).toContain(`value="Png Person"`);
        expect(await db.p.contender.findUnique({where: {id}})).toBeNull();
    });

    it("refuses a file that only starts like a jpeg", async () => {
        const id = newId();

        const res = await postMultipart(
            "/admin/contenders",
            {id, name: "Fake Person", company: "Test Co", ...credits},
            {data: FAKE_JPEG, type: "image/jpeg", name: "face.jpg"}
        );

        expect(res.status).toBe(400);
        expect(res.html).toContain("Upload a JPEG");
        expect(existsSync(join(store, `${id}.jpg`))).toBe(false);
    });

    it("refuses a photo over 2 MB", async () => {
        const id = newId();
        const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);

        const res = await postMultipart(
            "/admin/contenders",
            {id, name: "Big Person", company: "Test Co", ...credits},
            {data: big, type: "image/jpeg", name: "face.jpg"}
        );

        expect(res.status).toBe(400);
        expect(res.html).toContain("At most 2 MB");
        expect(existsSync(join(store, `${id}.jpg`))).toBe(false);
    });

    it("asks for the credits of a photo", async () => {
        const res = await postMultipart(
            "/admin/contenders",
            {id: newId(), name: "No Credit", company: "Test Co"},
            {data: JPEG, type: "image/jpeg", name: "face.jpg"}
        );

        expect(res.status).toBe(400);
        expect(res.html).toContain("A photo needs its author, licence and source");
    });

    it("checks the id, the names and the links", async () => {
        const res = await postMultipart("/admin/contenders", {
            id: "Not Kebab",
            name: "",
            company: "x".repeat(101),
            photoSource: "ftp://example.com",
        });

        expect(res.status).toBe(400);
        expect(res.html).toContain("Use lowercase letters, digits and single dashes");
        expect(res.html).toContain("Required");
        expect(res.html).toContain("At most 100 characters");
        expect(res.html).toContain("Must be a link starting with http:// or https://");
    });

    it("refuses an id that exists already", async () => {
        const res = await postMultipart("/admin/contenders", {id: "altman", name: "Again", company: "Test Co"});

        expect(res.status).toBe(409);
        expect(res.html).toContain("A contender with this id exists already");
    });

    it("edits a contender, replaces its photo and removes it", async () => {
        const id = newId();
        await postMultipart("/admin/contenders", {id, name: "Before", company: "Test Co"});

        const saved = await postMultipart(
            `/admin/contenders/${id}`,
            {name: "After", company: "Other Co", ...credits},
            {data: JPEG, type: "image/jpeg", name: "face.jpg"}
        );
        expect(saved.status).toBe(302);
        expect(saved.location).toBe(`/admin/contenders/${id}?done=saved`);
        expect((await get(`/club/${id}`)).html).toContain("After");
        expect(existsSync(join(store, `${id}.jpg`))).toBe(true);

        const removed = await postMultipart(`/admin/contenders/${id}`, {
            name: "After",
            company: "Other Co",
            ...credits,
            removePhoto: "1",
        });
        expect(removed.status).toBe(302);
        expect(existsSync(join(store, `${id}.jpg`))).toBe(false);
        expect((await fetch(`${BASE_URL}/assets/ceos/${id}.jpg`)).status).toBe(404);
    });

    it("has no page for an unknown contender", async () => {
        const res = await get("/admin/contenders/nobody", cookie);

        expect(res.status).toBe(404);
        expect(res.html).toContain("No contender with that id.");
    });

    it("deletes a contender without statements, with its photo", async () => {
        const id = newId();
        await postMultipart(
            "/admin/contenders",
            {id, name: "Gone Soon", company: "Test Co", ...credits},
            {data: JPEG, type: "image/jpeg", name: "face.jpg"}
        );

        const res = await postForm(`/admin/contenders/${id}/delete`, {}, cookie);

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin/contenders?done=deleted");
        expect(await db.p.contender.findUnique({where: {id}})).toBeNull();
        expect(existsSync(join(store, `${id}.jpg`))).toBe(false);
        expect((await get(`/club/${id}`)).status).toBe(404);
    });

    it("keeps a contender with an open proposal until it is closed", async () => {
        const id = newId();
        await postMultipart("/admin/contenders", {id, name: "Proposed", company: "Test Co"});
        const proposal = await db.p.proposal.create({
            data: {
                kind: "statement",
                origin: "scout",
                statementId: `${id}-2026-01-01-x`,
                body: JSON.stringify({ceo: id}),
            },
        });

        const page = await get(`/admin/contenders/${id}`, cookie);
        expect(page.html).toContain("Has 1 open proposal, so it can't be deleted.");
        const refused = await postForm(`/admin/contenders/${id}/delete`, {}, cookie);
        expect(refused.status).toBe(409);

        await db.p.proposal.update({where: {id: proposal.id}, data: {status: "rejected"}});
        expect((await postForm(`/admin/contenders/${id}/delete`, {}, cookie)).status).toBe(302);
    });

    it("draws the crest when a stored photo can't be drawn", async () => {
        const musk = join(store, "musk.jpg");
        const original = await readFile(musk);
        const id = newId();
        await postMultipart("/admin/contenders", {id, name: "Trigger", company: "Test Co"});
        const statement = await db.p.statement.findFirstOrThrow({where: {ceo: "musk", published: true}});
        try {
            await writeFile(musk, FAKE_JPEG);
            await postMultipart(`/admin/contenders/${id}`, {name: "Trigger", company: "Test Co"});

            expect((await fetch(`${BASE_URL}/og/${statement.id}.png`)).status).toBe(200);
            expect((await fetch(`${BASE_URL}/og.png`)).status).toBe(200);
        } finally {
            await writeFile(musk, original);
            await postMultipart(`/admin/contenders/${id}`, {name: "Trigger", company: "Test Co"});
        }
    });

    it("keeps a contender with statements", async () => {
        const page = await get("/admin/contenders/altman", cookie);
        expect(page.html).toContain("so it can't be deleted.");
        expect(page.html).not.toContain("Delete contender");

        const res = await postForm("/admin/contenders/altman/delete", {}, cookie);

        expect(res.status).toBe(409);
        expect(await db.p.contender.findUnique({where: {id: "altman"}})).not.toBeNull();
    });
});

describe("the rubric in the cms", () => {
    async function fields(change: Fields = {}): Promise<Fields> {
        const {rubric} = await loadContent();
        const out: Fields = {unitOne: rubric.unit.one, unitMany: rubric.unit.many};
        for (const c of rubric.categories) {
            out[`name_${c.id}`] = c.name;
            out[`question_${c.id}`] = c.question;
            for (const level of LEVELS) out[`level${level}_${c.id}`] = c.levels[level];
            out[`weight_${c.id}`] = String(c.weight);
            out[`awardName_${c.id}`] = c.award.name;
            out[`awardFor_${c.id}`] = c.award.for;
        }
        return {...out, ...change};
    }

    afterAll(async () => {
        await postForm("/admin/rubric", await fields(), cookie);
    });

    it("rescores every statement at once when a weight changes", async () => {
        const [first] = await readSeed();
        const before = await get(`/match/${first.id}`);
        expect(before.html).toContain("of a possible 25");

        const res = await postForm("/admin/rubric", await fields({weight_loss: "2", name_doom: "Gloom"}), cookie);

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin/rubric?done=saved");
        const after = await get(`/match/${first.id}`);
        expect(after.html).toContain("of a possible 30");
        expect(after.html).toContain("Gloom");
    });

    it("shows a changed level on the rules page", async () => {
        const res = await postForm(
            "/admin/rubric",
            await fields({level5_doom: "The sky, falling on schedule."}),
            cookie
        );

        expect(res.status).toBe(302);
        expect((await get("/rules")).html).toContain("<dt>5</dt><dd>The sky, falling on schedule.</dd>");
    });

    it("takes whole weights from 1 to 10 only, and every field", async () => {
        for (const weight of ["0", "11", "1.5", "two"]) {
            const res = await postForm("/admin/rubric", await fields({weight_loss: weight}), cookie);
            expect(res.status).toBe(400);
            expect(res.html).toContain("Use a whole number from 1 to 10");
        }
        const res = await postForm("/admin/rubric", await fields({unitMany: " "}), cookie);
        expect(res.status).toBe(400);
        expect(res.html).toContain("Required");
    });
});
