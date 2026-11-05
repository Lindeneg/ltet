import {beforeAll, describe, expect, it} from "vitest";
import {loadContent, readSeed, type Content, type RawStatement} from "../../src/lib/content.js";
import {db, get, login, postForm, uid} from "./helpers.js";
import RunRepository from "../../src/repositories/run-repository.js";
import {STALE_RUN_MS} from "../../src/services/scout-service.js";
import {success} from "../../src/lib/result.js";

let cookie: string;
let content: Content;
let seed: RawStatement[];

beforeAll(async () => {
    cookie = await login();
    content = await loadContent();
    seed = await readSeed();
});

function editorFields(statement: RawStatement, extra: Record<string, string> = {}): Record<string, string> {
    const {scores, ...rest} = statement;
    const fields: Record<string, string> = {json: JSON.stringify(rest)};
    for (const category of content.rubric.categories) {
        fields[`score_${category.id}`] = String(scores[category.id].score);
        fields[`reason_${category.id}`] = scores[category.id].reason;
    }
    return {...fields, ...extra};
}

async function propose(kind: "statement" | "suggestion" | "dispute", body: unknown, statementId: string | null = null) {
    const row = await db.p.proposal.create({
        data: {kind, origin: kind === "statement" ? "scout" : "visitor", statementId, body: JSON.stringify(body)},
    });
    return row.id;
}

function newStatement(): RawStatement {
    const id = `altman-2026-01-01-test-${uid()}`;
    return {...seed[0], id, ceo: "altman", date: "2026-01-01", headline: {...seed[0].headline, text: `Test ${id}`}};
}

async function bodyOf(id: string): Promise<RawStatement> {
    const row = await db.p.statement.findUniqueOrThrow({where: {id}});
    return JSON.parse(row.body);
}

describe("the inbox", () => {
    it("lists open proposals with their counts and the badge", async () => {
        const id = await propose("suggestion", {url: "https://example.com/inbox", note: `note ${uid()}`});

        const res = await get("/admin", cookie);

        expect(res.status).toBe(200);
        expect(res.html).toContain("Waiting for you");
        expect(res.html).toContain(`id="proposal-${id}"`);
        expect(res.html).toMatch(/Everything \(\d+\)/);
        expect(res.html).toMatch(/<span class="badge">\d+<\/span>/);
    });

    it("filters by kind and shows closed ones on request", async () => {
        const id = await propose("suggestion", {url: "https://example.com/kinds"});
        await postForm(`/admin/proposals/${id}/close`, {status: "done", kind: "all", view: "open"}, cookie);

        const disputes = await get("/admin?kind=dispute", cookie);
        const all = await get("/admin?kind=suggestion&status=all", cookie);

        expect(disputes.html).not.toContain(`id="proposal-${id}"`);
        expect(all.html).toContain("Everything, closed too");
        expect(all.html).toContain("Show open only");
        expect(all.html).toContain(`id="proposal-${id}"`);
        expect(all.html).toContain("done");
    });

    it("closes a suggestion as done", async () => {
        const id = await propose("suggestion", {url: "https://example.com/done"});

        const res = await postForm(
            `/admin/proposals/${id}/close`,
            {status: "done", note: "", kind: "suggestion", view: "open"},
            cookie
        );

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin?kind=suggestion&done=closed");
        expect((await get(res.location!, cookie)).html).toContain("Closed.");
        expect(await db.p.proposal.findUnique({where: {id}})).toMatchObject({status: "done", note: null});
    });

    it("rejects a dispute with a reason", async () => {
        const statementId = seed[1].id;
        const id = await propose(
            "dispute",
            {category: content.rubric.categories[0].id, direction: "more", comment: "Too low"},
            statementId
        );
        const inbox = await get("/admin", cookie);
        expect(inbox.html).toContain(`href="/admin/statements/${statementId}"`);
        expect(inbox.html).toContain("a visitor wants more pitchforks.");

        const res = await postForm(
            `/admin/proposals/${id}/close`,
            {status: "rejected", note: "Fair as it is", kind: "all", view: "open"},
            cookie
        );

        expect(res.location).toBe("/admin?done=rejected");
        expect(await db.p.proposal.findUnique({where: {id}})).toMatchObject({
            status: "rejected",
            note: "Fair as it is",
        });
    });

    it("refuses to close a proposal twice", async () => {
        const id = await propose("suggestion", {url: "https://example.com/twice"});
        await postForm(`/admin/proposals/${id}/close`, {status: "done"}, cookie);

        const res = await postForm(`/admin/proposals/${id}/close`, {status: "done"}, cookie);

        expect(res.status).toBe(404);
        expect(res.html).toContain("No open proposal with that number.");
    });

    it("refuses an unknown close status", async () => {
        const id = await propose("suggestion", {url: "https://example.com/status"});

        const res = await postForm(`/admin/proposals/${id}/close`, {status: "approved"}, cookie);

        expect(res.status).toBe(400);
        expect(res.html).toContain("status must be &quot;rejected&quot; or &quot;done&quot;.");
    });

    it("approves a proposed statement as the owner edited it", async () => {
        const statement = newStatement();
        const id = await propose("statement", statement, statement.id);
        const first = content.rubric.categories[0].id;

        const res = await postForm(
            `/admin/proposals/${id}/approve`,
            editorFields(statement, {
                [`score_${first}`]: "5",
                [`reason_${first}`]: "  Edited.  ",
                kind: "statement",
                view: "open",
            }),
            cookie
        );

        expect(res.status).toBe(302);
        expect(res.location).toBe("/admin?kind=statement&done=published");
        const saved = await db.p.statement.findUniqueOrThrow({where: {id: statement.id}});
        expect(saved).toMatchObject({published: true, origin: "scout"});
        expect(JSON.parse(saved.body).scores[first]).toEqual({score: 5, reason: "Edited."});
        expect(await db.p.proposal.findUnique({where: {id}})).toMatchObject({status: "approved"});
        expect((await get(`/match/${statement.id}`)).status).toBe(200);

        await postForm(`/admin/statements/${statement.id}/published`, {published: "0"}, cookie);
    });

    it("keeps the edits and lists the problems of an invalid statement", async () => {
        const statement = newStatement();
        const id = await propose("statement", statement, statement.id);

        const res = await postForm(
            `/admin/proposals/${id}/approve`,
            editorFields({...statement, quote: ""}, {note: "my note"}),
            cookie
        );

        expect(res.status).toBe(422);
        expect(res.html).toContain("The statement is not valid yet.");
        expect(res.html).toContain("quote missing");
        expect(res.html).toContain(`value="my note"`);
        expect(await db.p.statement.findUnique({where: {id: statement.id}})).toBeNull();
        expect(await db.p.proposal.findUnique({where: {id}})).toMatchObject({status: "open"});
    });

    it("refuses a statement whose id exists already", async () => {
        const statement = {...newStatement(), id: seed[2].id};
        const id = await propose("statement", statement, statement.id);

        const res = await postForm(`/admin/proposals/${id}/approve`, editorFields(statement), cookie);

        expect(res.status).toBe(422);
        expect(res.html).toContain(`a statement with the id ${seed[2].id} exists already`);
    });

    it("says when the json does not parse and keeps what was typed", async () => {
        const statement = newStatement();
        const id = await propose("statement", statement, statement.id);

        const res = await postForm(
            `/admin/proposals/${id}/approve`,
            {...editorFields(statement), json: "{broken"},
            cookie
        );

        expect(res.status).toBe(422);
        expect(res.html).toContain("The JSON does not parse: ");
        expect(res.html).toContain("{broken</textarea>");
    });

    it("approves only proposed statements", async () => {
        const id = await propose("suggestion", {url: "https://example.com/approve"});

        const res = await postForm(`/admin/proposals/${id}/approve`, editorFields(newStatement()), cookie);

        expect(res.status).toBe(400);
        expect(res.html).toContain("Only a proposed statement can be approved; close the others.");
    });
});

describe("the statements", () => {
    it("lists every statement and searches them", async () => {
        const all = await get("/admin/statements", cookie);
        const found = await get(`/admin/statements?q=${encodeURIComponent(seed[3].id)}`, cookie);

        expect(all.status).toBe(200);
        expect(all.html).toMatch(/Statements \(\d+\)/);
        expect(found.html).toContain(`value="${seed[3].id}"`);
        const shown = found.html.match(/<tr[^>]*data-search="[^"]*"(?! hidden)>/g) ?? [];
        expect(shown).toHaveLength(1);
    });

    it("shows a statement with its editor and a link to the site", async () => {
        const res = await get(`/admin/statements/${seed[4].id}`, cookie);

        expect(res.status).toBe(200);
        expect(res.html).toContain(`href="/match/${seed[4].id}"`);
        expect(res.html).toContain("No changes since it went in.");
        expect(res.html).toContain(`name="json"`);
    });

    it("saves an edit with its note and keeps it in the history", async () => {
        const id = seed[5].id;
        const before = await bodyOf(id);

        const res = await postForm(
            `/admin/statements/${id}`,
            editorFields({...before, context: "Changed context."}, {note: "clearer"}),
            cookie
        );

        expect(res.status).toBe(302);
        expect(res.location).toBe(`/admin/statements/${id}?done=saved`);
        expect((await bodyOf(id)).context).toBe("Changed context.");
        const page = await get(res.location!, cookie);
        expect(page.html).toContain("Saved.");
        expect(page.html).toContain("clearer (the version before");
        const history = await db.p.statementHistory.findFirstOrThrow({where: {statementId: id}, orderBy: {id: "desc"}});
        expect(JSON.parse(history.body).context).toBe(before.context);

        const loaded = await get(`/admin/statements/${id}?load=${history.id}`, cookie);
        expect(loaded.html).toContain("Loaded into the editor. Save to restore it.");
        expect(loaded.html).toContain(JSON.stringify(before.context).slice(1, 20));
    });

    it("notes an edit without a note as edited", async () => {
        const id = seed[6].id;

        await postForm(`/admin/statements/${id}`, editorFields(await bodyOf(id)), cookie);

        const history = await db.p.statementHistory.findFirstOrThrow({where: {statementId: id}, orderBy: {id: "desc"}});
        expect(history.note).toBe("edited");
    });

    it("refuses a changed id, an invalid statement and broken json", async () => {
        const id = seed[7].id;
        const body = await bodyOf(id);

        const changed = await postForm(`/admin/statements/${id}`, editorFields({...body, id: "another-id"}), cookie);
        const invalid = await postForm(`/admin/statements/${id}`, editorFields({...body, ceo: "nobody"}), cookie);
        const broken = await postForm(`/admin/statements/${id}`, {...editorFields(body), json: "nope"}, cookie);

        expect(changed.status).toBe(400);
        expect(changed.html).toContain("The id cannot change.");
        expect(invalid.status).toBe(422);
        expect(invalid.html).toContain("The statement is not valid.");
        expect(invalid.html).toContain("unknown ceo &quot;nobody&quot;");
        expect(broken.status).toBe(422);
        expect(broken.html).toContain("The JSON does not parse: ");
        expect(await bodyOf(id)).toEqual(body);
    });

    it("hides a statement from the site and shows it again", async () => {
        const id = seed[8].id;

        const hidden = await postForm(`/admin/statements/${id}/published`, {published: "0", note: "checking"}, cookie);
        expect(hidden.location).toBe(`/admin/statements/${id}?done=hidden`);
        expect((await db.p.statement.findUniqueOrThrow({where: {id}})).published).toBe(false);
        expect((await get(`/match/${id}`)).status).toBe(404);
        expect((await get(hidden.location!, cookie)).html).toContain("Hidden from the site.");

        const shown = await postForm(`/admin/statements/${id}/published`, {published: "1"}, cookie);
        expect(shown.location).toBe(`/admin/statements/${id}?done=shown`);
        expect((await db.p.statement.findUniqueOrThrow({where: {id}})).published).toBe(true);
        expect((await get(`/match/${id}`)).status).toBe(200);
        expect((await get(shown.location!, cookie)).html).toContain("Back on the site.");
    });

    it("answers 404 for a statement that doesn't exist", async () => {
        const page = await get("/admin/statements/no-such-statement", cookie);
        const save = await postForm(
            "/admin/statements/no-such-statement",
            editorFields({...seed[0], id: "no-such-statement"}),
            cookie
        );
        const hide = await postForm("/admin/statements/no-such-statement/published", {published: "0"}, cookie);

        for (const res of [page, save, hide]) {
            expect(res.status).toBe(404);
            expect(res.html).toContain("No statement with that id.");
        }
    });
});

describe("the runs", () => {
    it("lists the runs and shows one with its log", async () => {
        const run = await db.p.run.create({
            data: {
                status: "ok",
                summary: JSON.stringify({since: "2026-10-01", proposed: 2, costUsd: 0.5}),
                log: "a <b>log</b> line",
            },
        });

        const list = await get("/admin/runs", cookie);
        const page = await get(`/admin/runs/${run.id}`, cookie);

        expect(list.html).toContain(`href="/admin/runs/${run.id}"`);
        expect(list.html).toContain("$0.5");
        expect(page.html).toContain(`Run ${run.id}: Done`);
        expect(page.html).toContain("a &lt;b&gt;log&lt;/b&gt; line");
    });

    it("shows the start form, with no schedule outside production", async () => {
        const list = await get("/admin/runs", cookie);

        expect(list.html).toContain(`<form method="post" action="/admin/runs"`);
        expect(list.html).toContain("Next run: none, the schedule runs only in production.");
    });

    it("refuses to start while a run is going, without starting the scout", async () => {
        const running = await db.p.run.create({data: {status: "running", startedBy: "schedule"}});

        const res = await postForm("/admin/runs", {since: ""}, cookie);

        expect(res.status).toBe(409);
        expect(res.html).toContain("A run is already going.");
        expect(await db.p.run.count({where: {id: {gt: running.id}}})).toBe(0);
        await db.p.run.update({where: {id: running.id}, data: {status: "failed"}});
    });

    it("claims against runs the client wrote, comparing their dates as the client stores them", async () => {
        const repo = new RunRepository(db);
        const staleBefore = () => new Date(Date.now() - STALE_RUN_MS);
        await db.p.run.updateMany({where: {status: "running"}, data: {status: "failed"}});
        const recent = await db.p.run.create({
            data: {status: "running", startedBy: "schedule", startedAt: new Date(Date.now() - 10 * 60_000)},
        });

        expect(await repo.claim({startedBy: "e2e", dryRun: true, staleBefore: staleBefore()})).toEqual(success(null));

        await db.p.run.update({where: {id: recent.id}, data: {startedAt: new Date(Date.now() - 4 * 3_600_000)}});
        const before = Date.now();
        const claimed = await repo.claim({startedBy: "e2e", dryRun: true, staleBefore: staleBefore()});
        const after = Date.now();

        expect(claimed.ok && claimed.data).toBeGreaterThan(recent.id);
        const row = await db.p.run.findUniqueOrThrow({where: {id: (claimed as {data: number}).data}});
        expect(row.startedAt).toBeInstanceOf(Date);
        expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(row.startedAt.getTime()).toBeLessThanOrEqual(after);
        expect(row).toMatchObject({status: "running", startedBy: "e2e", dryRun: true});
        expect(await repo.claim({startedBy: "e2e", dryRun: true, staleBefore: staleBefore()})).toEqual(success(null));

        await db.p.run.updateMany({where: {id: {in: [recent.id, row.id]}}, data: {status: "failed"}});
    });

    it("refuses a since date out of range", async () => {
        const res = await postForm("/admin/runs", {since: "2020-01-01"}, cookie);

        expect(res.status).toBe(400);
        expect(res.html).toContain("Use a date from 2022-11-30 to today, as YYYY-MM-DD.");
    });

    it("links a finished run to the proposals it made", async () => {
        const run = await db.p.run.create({data: {status: "ok", summary: JSON.stringify({since: "2026-10-01"})}});
        const proposal = await db.p.proposal.create({
            data: {kind: "statement", origin: "scout", statementId: `e2e-${uid()}`, body: "{}", runId: run.id},
        });

        const page = await get(`/admin/runs/${run.id}`, cookie);

        expect(page.html).toContain(`href="/admin?status=all#proposal-${proposal.id}"`);
        expect(page.html).toContain("<dt>Since</dt><dd>2026-10-01</dd>");
    });

    it("pages the runs and answers 404 past the last page", async () => {
        expect((await get("/admin/runs?page=1", cookie)).status).toBe(200);
        expect((await get("/admin/runs?page=9999", cookie)).status).toBe(404);
    });

    it("answers 404 for a run that doesn't exist", async () => {
        for (const path of ["/admin/runs/99999", "/admin/runs/abc"]) {
            const res = await get(path, cookie);
            expect(res.status).toBe(404);
            expect(res.html).toContain("No run with that number.");
        }
    });
});

describe("the scout's time", () => {
    it("is 06:00 until saved, and keeps what is saved", async () => {
        await db.p.setting.deleteMany({where: {key: "scoutTime"}});
        expect((await get("/admin/settings", cookie)).html).toContain(`name="scoutTime" type="time" value="06:00"`);

        const res = await postForm("/admin/settings/scout", {scoutTime: "07:45"}, cookie);

        expect(res.location).toBe("/admin/settings?done=saved");
        expect((await get("/admin/settings", cookie)).html).toContain(`name="scoutTime" type="time" value="07:45"`);
        await db.p.setting.deleteMany({where: {key: "scoutTime"}});
    });
});

describe("an unknown cms path", () => {
    it("answers 404 inside the cms", async () => {
        const res = await get("/admin/nowhere", cookie);

        expect(res.status).toBe(404);
        expect(res.html).toContain("Page not found");
        expect(res.html).toContain("Log out");
    });
});
