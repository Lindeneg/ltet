import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import {inboxRouter} from "../../../src/routers/admin/inbox.js";
import type StatementService from "../../../src/services/statement-service.js";
import {WriteError} from "../../../src/services/statement-service.js";
import type {InboxItem} from "../../../src/services/proposal-service.js";
import {fake, makeProposal, makeStatement, makeContentService} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

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

function inboxPage(items: InboxItem[], page = 1, pages = 1) {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return success({items, counts, page, pages});
}

describe("inbox router", () => {
    let approve: Mock;
    let approvable: Mock;
    let proposals: ReturnType<typeof fakeProposalService>;
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        approve = vi.fn().mockResolvedValue(success("an-id"));
        approvable = vi.fn().mockResolvedValue(success(makeProposal({id: 1})));
        proposals = fakeProposalService({
            inbox: vi.fn().mockResolvedValue(
                inboxPage([
                    {
                        ...makeProposal({
                            id: 3,
                            kind: "suggestion",
                            body: {url: "javascript:alert(1)", quote: "<b>q</b>"},
                        }),
                        statement: null,
                    },
                    {
                        ...makeProposal({id: 2, kind: "dispute", body: {category: "doom", direction: "less"}}),
                        statement: makeStatement(),
                    },
                    {...makeProposal({id: 1}), statement: null},
                ])
            ),
            lastPage: vi.fn().mockResolvedValue(success(2)),
        });
        app = await serveAdmin(
            inboxRouter(proposals.service, fake<StatementService>({approve, approvable}), makeContentService())
        );
    });

    afterEach(() => app.close());

    it("shows every kind with counts and the badge", async () => {
        const html = await (await app.get("/admin")).text();

        expect(proposals.impl.inbox).toHaveBeenCalledWith({status: "open", kind: null}, 1, false);
        expect(html).toContain("Waiting for you");
        expect(html).toContain("Everything (3)");
        expect(html).toContain("Score disputes (1)");
        expect(html).toContain(`<span class="badge">3</span>`);
        expect(html).toContain("Doom: ");
        expect(html).toContain("a visitor wants fewer pitchforks.");
        expect(html).toContain("Approve and publish");
    });

    it("never links a visitor's url that isn't http and escapes what they wrote", async () => {
        const html = await (await app.get("/admin")).text();

        expect(html).not.toContain(`href="javascript:`);
        expect(html).toContain("&lt;b&gt;q&lt;/b&gt;");
    });

    it("filters by kind and asks for closed ones too", async () => {
        const html = await (await app.get("/admin?kind=dispute&status=all")).text();

        expect(proposals.impl.inbox).toHaveBeenCalledWith({status: "all", kind: "dispute"}, 1, false);
        expect(html).toContain("Everything, closed too");
        expect(html).toContain(`href="/admin?kind=dispute"`);
    });

    it("treats an unknown kind as everything", async () => {
        await app.get("/admin?kind=<x>");

        expect(proposals.impl.inbox).toHaveBeenCalledWith({status: "open", kind: null}, 1, false);
    });

    it("asks for the page in the address", async () => {
        await app.get("/admin?status=all&page=3");

        expect(proposals.impl.inbox).toHaveBeenCalledWith({status: "all", kind: null}, 3, false);
    });

    it("an out-of-range or bad page is a 404", async () => {
        proposals.impl.inbox.mockResolvedValue(failure(AppError.NOT_FOUND));
        const past = await app.get("/admin?page=9");
        expect(past.status).toBe(404);
        expect(await past.text()).toContain("Page not found");

        proposals.impl.inbox.mockClear();
        for (const page of ["0", "x", "-1", "1.5", ""]) {
            expect((await app.get(`/admin?page=${page}`)).status, page).toBe(404);
        }
        expect(proposals.impl.inbox).not.toHaveBeenCalled();
    });

    it("says something went wrong when the inbox can't be read", async () => {
        proposals.impl.inbox.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await app.get("/admin")).status).toBe(500);
    });

    it("the pager links the next and previous page", async () => {
        proposals.impl.inbox.mockResolvedValue(inboxPage([], 2, 3));

        const html = await (await app.get("/admin?kind=dispute&page=2")).text();

        expect(html).toContain(`<a class="button quiet" href="/admin?kind=dispute">Newer</a>`);
        expect(html).toContain(`<a class="button quiet" href="/admin?kind=dispute&page=3">Older</a>`);
    });

    it("a decision returns to the page it was made on", async () => {
        const res = await app.post("/admin/proposals/3/close", {status: "done", view: "all", page: "2"});

        expect(res.headers.get("location")).toBe("/admin?status=all&page=2&done=closed");
        expect(proposals.impl.lastPage).toHaveBeenCalledWith({status: "all", kind: null});
    });

    it("a decision on the last item of the last page returns to the page before", async () => {
        proposals.impl.lastPage.mockResolvedValue(success(2));

        const res = await app.post("/admin/proposals/3/close", {status: "rejected", page: "3"});

        expect(res.headers.get("location")).toBe("/admin?page=2&done=rejected");
    });

    it("a decision from the first page asks for no page count", async () => {
        const res = await app.post("/admin/proposals/3/close", {status: "done", page: "1"});

        expect(res.headers.get("location")).toBe("/admin?done=closed");
        expect(proposals.impl.lastPage).not.toHaveBeenCalled();
    });

    it("a failed decision re-renders its page, or the last one", async () => {
        approve.mockResolvedValue(failure({code: WriteError.INVALID, errors: []}));

        const res = await app.post("/admin/proposals/1/approve", editorFields(makeStatement(), {page: "4"}));

        expect(res.status).toBe(422);
        expect(proposals.impl.inbox).toHaveBeenCalledWith({status: "open", kind: null}, 4, true);
    });

    it("shows a toast after a change", async () => {
        expect(await (await app.get("/admin?done=published")).text()).toContain("Published.");
        expect(await (await app.get("/admin?done=nonsense")).text()).not.toContain(`class="toast"`);
    });

    it("approves a statement with the edited scores and goes back to the same view", async () => {
        const statement = makeStatement();

        const res = await app.post(
            "/admin/proposals/1/approve",
            editorFields(statement, {score_doom: "4", kind: "statement", view: "all"})
        );

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin?kind=statement&status=all&done=published");
        expect(approve).toHaveBeenCalledWith(1, {
            ...statement,
            scores: {...statement.scores, doom: {score: 4, reason: "A reason."}},
        });
    });

    it("shows the problems of an invalid statement on its card and keeps the edits", async () => {
        approve.mockResolvedValue(failure({code: WriteError.INVALID, errors: ["quote missing"]}));

        const res = await app.post(
            "/admin/proposals/1/approve",
            editorFields(makeStatement(), {reason_doom: "kept reason", note: "kept note"})
        );

        expect(res.status).toBe(422);
        const html = await res.text();
        expect(html).toContain("The statement is not valid yet.");
        expect(html).toContain("<li>quote missing</li>");
        expect(html).toContain(`value="kept reason"`);
        expect(html).toContain(`value="kept note"`);
    });

    it("says when the json does not parse", async () => {
        const res = await app.post("/admin/proposals/1/approve", {...editorFields(makeStatement()), json: "{"});

        expect(res.status).toBe(422);
        expect(await res.text()).toContain("The JSON does not parse: ");
        expect(approve).not.toHaveBeenCalled();
    });

    it("maps the other approval failures", async () => {
        const cases: Array<[unknown, number, string]> = [
            [{code: WriteError.NOT_OPEN, errors: []}, 404, "No open proposal with that number."],
            [
                {code: WriteError.NOT_A_STATEMENT, errors: []},
                400,
                "Only a proposed statement can be approved; close the others.",
            ],
            [{code: AppError.DB_ERROR, errors: []}, 500, "Something went wrong."],
        ];
        for (const [ctx, status, message] of cases) {
            approve.mockResolvedValue(failure(ctx));
            const res = await app.post("/admin/proposals/1/approve", editorFields(makeStatement()));
            expect(res.status, message).toBe(status);
            expect(await res.text()).toContain(message);
        }
    });

    it("reports a suggestion's own message before it reads the form", async () => {
        approvable.mockResolvedValue(failure({code: WriteError.NOT_A_STATEMENT, errors: []}));

        const res = await app.post("/admin/proposals/3/approve", {kind: "all", view: "open"});

        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Only a proposed statement can be approved; close the others.");
        expect(html).not.toContain("The JSON does not parse");
        expect(approvable).toHaveBeenCalledWith(3);
        expect(approve).not.toHaveBeenCalled();
    });

    it("says a closed proposal is not open before it reads the form", async () => {
        approvable.mockResolvedValue(failure({code: WriteError.NOT_OPEN, errors: []}));

        const res = await app.post("/admin/proposals/1/approve", {json: "{"});

        expect(res.status).toBe(404);
        expect(await res.text()).toContain("No open proposal with that number.");
    });

    it("closes as done or rejected with the reason", async () => {
        const done = await app.post("/admin/proposals/3/close", {
            status: "done",
            note: "  ",
            kind: "all",
            view: "open",
        });
        const rejected = await app.post("/admin/proposals/2/close", {
            status: "rejected",
            note: " Not fair ",
            kind: "dispute",
        });

        expect(done.headers.get("location")).toBe("/admin?done=closed");
        expect(rejected.headers.get("location")).toBe("/admin?kind=dispute&done=rejected");
        expect(proposals.impl.close).toHaveBeenCalledWith(3, "done", null);
        expect(proposals.impl.close).toHaveBeenCalledWith(2, "rejected", "Not fair");
    });

    it("refuses another status and a proposal that isn't open", async () => {
        const bad = await app.post("/admin/proposals/3/close", {status: "approved"});
        expect(bad.status).toBe(400);

        proposals.impl.close.mockResolvedValue(failure(AppError.NOT_FOUND));
        const gone = await app.post("/admin/proposals/9/close", {status: "done"});
        expect(gone.status).toBe(404);
        expect(await gone.text()).toContain("No open proposal with that number.");

        const notANumber = await app.post("/admin/proposals/x/close", {status: "done"});
        expect(notANumber.status).toBe(404);
    });
});
