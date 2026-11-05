import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {rubricRouter} from "../../../src/routers/admin/rubric.js";
import type ContentService from "../../../src/services/content-service.js";
import {fake, makeContent} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

const fields = (change: Record<string, string> = {}) => ({
    unitOne: "pitchfork",
    unitMany: "pitchforks",
    name_loss: "Loss",
    question_loss: "Loss?",
    level0_loss: "Loss none",
    level1_loss: "Loss a trace",
    level3_loss: "Loss clear",
    level5_loss: "Loss at worst",
    weight_loss: "1",
    awardName_loss: "Award",
    awardFor_loss: "for something",
    name_doom: "Doom",
    question_doom: "Doom?",
    level0_doom: "Doom none",
    level1_doom: "Doom a trace",
    level3_doom: "Doom clear",
    level5_doom: "Doom at worst",
    weight_doom: "2",
    awardName_doom: "Award",
    awardFor_doom: "for something",
    ...change,
});

describe("rubric router", () => {
    let service: {get: Mock; saveRubric: Mock};
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    beforeEach(async () => {
        service = {
            get: vi.fn().mockReturnValue(makeContent()),
            saveRubric: vi.fn().mockResolvedValue(success(undefined)),
        };
        app = await serveAdmin(rubricRouter(fake<ContentService>(service), fakeProposalService().service));
    });

    afterEach(() => app.close());

    it("shows every category with its id as the heading", async () => {
        const html = await (await app.get("/admin/rubric")).text();

        expect(html).toContain("<legend>loss</legend>");
        expect(html).toContain(`name="weight_doom" type="number" value="2" min="1" max="10" step="1"`);
        expect(html).toContain("A weight change rescores every statement at once.");
    });

    it("shows what each count's 0, 1, 3 and 5 mean as fields", async () => {
        const html = await (await app.get("/admin/rubric")).text();

        expect(html).toContain(`<label>Scores 0 <input name="level0_loss" type="text" value="Loss none" />`);
        expect(html).toContain(`<label>Scores 5 <input name="level5_doom" type="text" value="Doom at worst" />`);
    });

    it("saves the trimmed values in the rubric's order", async () => {
        const res = await app.post(
            "/admin/rubric",
            fields({weight_loss: "10", name_doom: " Gloom ", level5_doom: " Gloom at worst "})
        );

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/admin/rubric?done=saved");
        const edit = service.saveRubric.mock.calls[0][0];
        expect(edit.unit).toEqual({one: "pitchfork", many: "pitchforks"});
        expect(edit.categories.map((c: {id: string}) => c.id)).toEqual(["loss", "doom"]);
        expect(edit.categories[0].weight).toBe(10);
        expect(edit.categories[1].name).toBe("Gloom");
        expect(edit.categories[1].levels).toEqual({
            0: "Doom none",
            1: "Doom a trace",
            3: "Doom clear",
            5: "Gloom at worst",
        });
    });

    it("keeps the form with the errors", async () => {
        const res = await app.post("/admin/rubric", fields({weight_doom: "0", question_loss: "", level3_doom: ""}));

        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Use a whole number from 1 to 10");
        expect(html).toContain("Required");
        expect(html).toContain(`name="weight_doom" type="number" value="0"`);
        expect(html).toContain(`name="level3_doom" type="text" value="" /><span class="error">Required</span>`);
        expect(service.saveRubric).not.toHaveBeenCalled();
    });

    it("says something went wrong when saving fails", async () => {
        service.saveRubric.mockResolvedValue(failure("db_error"));

        const res = await app.post("/admin/rubric", fields());

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("Something went wrong.");
    });
});
