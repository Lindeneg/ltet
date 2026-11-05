import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import {statementsRouter} from "../../../src/routers/admin/statements.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type StatementService from "../../../src/services/statement-service.js";
import {WriteError} from "../../../src/services/statement-service.js";
import {fake, makeStatement, makeStatementRecord, makeContentService} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

const id = makeStatement().id;
const path = `/admin/statements/${id}`;

function editorFields(statement: RawStatement, extra: Record<string, string> = {}) {
    const {scores, ...rest} = statement;
    return {
        json: JSON.stringify(rest),
        score_loss: String(scores.loss.score),
        reason_loss: scores.loss.reason,
        score_doom: String(scores.doom.score),
        reason_doom: scores.doom.reason,
        ...extra,
    };
}

describe("statements router", () => {
    let repo: {listAll: Mock; get: Mock};
    let service: {save: Mock; setPublished: Mock};
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        const older = makeStatement({context: "The older context."});
        repo = {
            listAll: vi.fn().mockResolvedValue(
                success([
                    makeStatementRecord(),
                    makeStatementRecord({
                        id: "musk-2025-01-01-other",
                        published: false,
                        body: makeStatement({id: "musk-2025-01-01-other", ceo: "musk", quote: "Other words"}),
                    }),
                ])
            ),
            get: vi.fn().mockResolvedValue(
                success({
                    ...makeStatementRecord(),
                    history: [
                        {
                            id: 7,
                            statementId: id,
                            body: older,
                            published: false,
                            note: "a note",
                            changedAt: new Date("2025-09-02T10:00:00Z"),
                        },
                    ],
                })
            ),
        };
        service = {
            save: vi.fn().mockResolvedValue(success(undefined)),
            setPublished: vi.fn().mockResolvedValue(success(undefined)),
        };
        app = await serveAdmin(
            statementsRouter(
                fake<StatementRepository>(repo),
                fake<StatementService>(service),
                fakeProposalService().service,
                makeContentService()
            )
        );
    });

    afterEach(() => app.close());

    it("lists every statement with its pitchforks and whether it is live", async () => {
        const html = await (await app.get("/admin/statements")).text();

        expect(html).toContain("Statements (2)");
        expect(html).toContain(`href="${path}"`);
        expect(html).toContain(`class="num">5</td>`);
        expect(html).toContain(`class="hidden-row"`);
        expect(html).toContain(">hidden</td>");
    });

    it("hides the rows a search doesn't match", async () => {
        const html = await (await app.get("/admin/statements?q=elon%20other")).text();

        expect(html).toContain(`value="elon other"`);
        expect(html.match(/<tr[^>]*data-search="[^"]*" hidden>/g)).toHaveLength(1);
        expect(html).toMatch(/data-search="musk-2025-01-01-other[^"]*">/);
    });

    it("shows a statement with its editor, history and a link to the site", async () => {
        const html = await (await app.get(path)).text();

        expect(html).toContain(`href="/match/${id}"`);
        expect(html).toContain("Hide from the site");
        expect(html).toContain("a note (the version before: 5 pitchforks, hidden)");
        expect(html).toContain(`href="${path}?load=7"`);
        expect(html).toContain("5 pitchforks</span>");
    });

    it("loads an older version into the editor", async () => {
        const html = await (await app.get(`${path}?load=7`)).text();

        expect(html).toContain("Loaded into the editor. Save to restore it.");
        expect(html).toContain("The older context.");
    });

    it("answers 404 for a statement that doesn't exist", async () => {
        repo.get.mockResolvedValue(success(null));

        const res = await app.get(path);

        expect(res.status).toBe(404);
        expect(await res.text()).toContain("No statement with that id.");
    });

    it("saves an edit with its note", async () => {
        const statement = makeStatement({context: "New."});

        const res = await app.post(path, editorFields(statement, {note: " clearer "}));

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(`${path}?done=saved`);
        expect(service.save).toHaveBeenCalledWith(id, statement, "clearer");
    });

    it("notes an edit without a note as edited", async () => {
        await app.post(path, editorFields(makeStatement()));

        expect(service.save).toHaveBeenCalledWith(id, expect.anything(), "edited");
    });

    it("maps the save failures and keeps the edits", async () => {
        const cases: Array<[unknown, number, string]> = [
            [{code: WriteError.ID_CHANGED, errors: []}, 400, "The id cannot change."],
            [{code: WriteError.INVALID, errors: ["quote missing"]}, 422, "The statement is not valid."],
            [{code: WriteError.NOT_FOUND, errors: []}, 404, "No statement with that id."],
            [{code: AppError.DB_ERROR, errors: []}, 500, "Something went wrong."],
        ];
        for (const [ctx, status, message] of cases) {
            service.save.mockResolvedValue(failure(ctx));
            const res = await app.post(path, editorFields(makeStatement(), {reason_loss: "typed"}));
            expect(res.status, message).toBe(status);
            const html = await res.text();
            expect(html).toContain(message);
            if (status !== 404) expect(html).toContain(`value="typed"`);
        }
    });

    it("says when the json does not parse", async () => {
        const res = await app.post(path, {...editorFields(makeStatement()), json: "nope"});

        expect(res.status).toBe(422);
        const html = await res.text();
        expect(html).toContain("The JSON does not parse: ");
        expect(html).toContain(">nope</textarea>");
        expect(service.save).not.toHaveBeenCalled();
    });

    it("hides and shows a statement", async () => {
        const hidden = await app.post(`${path}/published`, {published: "0", note: "why"});
        const shown = await app.post(`${path}/published`, {published: "1"});

        expect(hidden.headers.get("location")).toBe(`${path}?done=hidden`);
        expect(shown.headers.get("location")).toBe(`${path}?done=shown`);
        expect(service.setPublished).toHaveBeenCalledWith(id, false, "why");
        expect(service.setPublished).toHaveBeenCalledWith(id, true, null);
    });

    it("refuses a published value that isn't 1 or 0, and a missing statement", async () => {
        expect((await app.post(`${path}/published`, {published: "yes"})).status).toBe(400);

        service.setPublished.mockResolvedValue(failure({code: WriteError.NOT_FOUND, errors: []}));
        const res = await app.post(`${path}/published`, {published: "1"});
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("No statement with that id.");
    });
});
