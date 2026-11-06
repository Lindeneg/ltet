import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import {SkipReason, type ImportPlan} from "../../../src/lib/statement-import.js";
import {importRouter} from "../../../src/routers/admin/import.js";
import type StatementService from "../../../src/services/statement-service.js";
import {fake, makeStatement} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

const body = makeStatement({venue: "A podcast"});
const edits = [{id: body.id, set: {venue: {from: "An interview", to: "A podcast"}}}];
const file = JSON.stringify({edits});

const plan: ImportPlan = {
    ready: [
        {id: body.id, updatedAt: new Date(), body, changes: [{path: "venue", from: "An interview", to: "A podcast"}]},
    ],
    unchanged: ["musk-2025-01-01-same"],
    skipped: [{id: "nobody-2025-01-01-x", reasons: [{reason: SkipReason.UNKNOWN_ID}]}],
};

describe("import router", () => {
    let service: {planImport: Mock; applyImport: Mock};
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        service = {
            planImport: vi.fn().mockResolvedValue(success(plan)),
            applyImport: vi.fn().mockResolvedValue(success(plan)),
        };
        app = await serveAdmin(importRouter(fake<StatementService>(service), fakeProposalService().service));
    });

    afterEach(() => app.close());

    it("shows the form with the format", async () => {
        const res = await app.get("/admin/import");
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain("Import edits");
        expect(html).toContain('action="/admin/import/preview"');
        expect(html).toContain("&quot;edits&quot;");
    });

    it("previews without applying", async () => {
        const res = await app.post("/admin/import/preview", {edits: file});
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(service.planImport).toHaveBeenCalledWith(edits);
        expect(service.applyImport).not.toHaveBeenCalled();
        expect(html).toContain("1 statement will change, 1 skipped, 1 unchanged.");
        expect(html).toContain("&quot;An interview&quot;");
        expect(html).toContain("&quot;A podcast&quot;");
        expect(html).toContain(SkipReason.UNKNOWN_ID);
        expect(html).toContain("musk-2025-01-01-same");
        expect(html).toContain('action="/admin/import/apply"');
        expect(html).toContain(`value="${file.replaceAll('"', "&quot;")}"`);
        expect(html).toContain("Apply to 1 statement");
    });

    it("offers no apply when nothing will change", async () => {
        service.planImport.mockResolvedValue(success({...plan, ready: []}));
        const html = await (await app.post("/admin/import/preview", {edits: file})).text();
        expect(html).toContain("Nothing to apply.");
        expect(html).not.toContain('action="/admin/import/apply"');
    });

    it("applies and shows the result", async () => {
        const res = await app.post("/admin/import/apply", {edits: file});
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(service.applyImport).toHaveBeenCalledWith(edits);
        expect(html).toContain("Applied to 1 statement.");
        expect(html).toContain(SkipReason.UNKNOWN_ID);
        expect(html).not.toContain('action="/admin/import/apply"');
    });

    it.each(["/admin/import/preview", "/admin/import/apply"])("keeps the text on a form error at %s", async (path) => {
        const res = await app.post(path, {edits: "{nope"});
        const html = await res.text();
        expect(res.status).toBe(422);
        expect(html).toContain("The file is not valid JSON.");
        expect(html).toContain("{nope</textarea>");
        expect(service.planImport).not.toHaveBeenCalled();
        expect(service.applyImport).not.toHaveBeenCalled();
    });

    it("treats a missing field as an empty file", async () => {
        const res = await app.post("/admin/import/preview", {});
        expect(res.status).toBe(422);
        expect(await res.text()).toContain("The file is not valid JSON.");
    });

    it("answers 500 when the service fails", async () => {
        service.applyImport.mockResolvedValue(failure({code: AppError.DB_ERROR, errors: []}));
        const res = await app.post("/admin/import/apply", {edits: file});
        expect(res.status).toBe(500);
        expect(await res.text()).toContain("Something went wrong.");
    });
});
