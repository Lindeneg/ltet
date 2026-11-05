import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import type {RawStatement} from "../../../src/lib/content.js";
import {inboxRouter} from "../../../src/routers/admin/inbox.js";
import type StatementService from "../../../src/services/statement-service.js";
import {WriteError} from "../../../src/services/statement-service.js";
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

describe("inbox router", () => {
    let approve: Mock;
    let proposals: ReturnType<typeof fakeProposalService>;
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        approve = vi.fn().mockResolvedValue(success("an-id"));
        proposals = fakeProposalService({
            inbox: vi.fn().mockResolvedValue(
                success([
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
        });
        app = await serveAdmin(inboxRouter(proposals.service, fake<StatementService>({approve}), makeContentService()));
    });

    afterEach(() => app.close());

    it("shows every kind with counts and the badge", async () => {
        const html = await (await app.get("/admin")).text();

        expect(proposals.impl.inbox).toHaveBeenCalledWith("open");
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

        expect(proposals.impl.inbox).toHaveBeenCalledWith("all");
        expect(html).toContain("Everything, closed too");
        expect(html).toContain(`id="proposal-2"`);
        expect(html).not.toContain(`id="proposal-1"`);
        expect(html).toContain(`href="/admin?kind=dispute"`);
    });

    it("treats an unknown kind as everything", async () => {
        expect(await (await app.get("/admin?kind=<x>")).text()).toContain(`id="proposal-1"`);
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
