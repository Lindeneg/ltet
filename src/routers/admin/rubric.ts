import {Router, type Request, type Response} from "express";
import {send} from "../../lib/http.js";
import type {Category} from "../../lib/content.js";
import type ContentService from "../../services/content-service.js";
import type ProposalService from "../../services/proposal-service.js";
import {CATEGORY_FIELDS, RubricView, categoryField, type RubricValues} from "../../ui/views/admin/rubric.js";
import {SOMETHING_WENT_WRONG, adminPage, withDone} from "./respond.js";

const WEIGHT_ERROR = "Use a whole number from 1 to 10";

export function rubricRouter(content: ContentService, proposalService: ProposalService): Router {
    const router = Router();

    async function render(
        req: Request,
        res: Response,
        props: {values?: RubricValues; errors?: Record<string, string>; topError?: string} = {},
        status = 200
    ) {
        const page = await adminPage(req, proposalService, "rubric");
        send(res, RubricView({page, rubric: content.get().rubric, ...props}), status);
    }

    router.get("/rubric", async (req, res) => {
        await render(req, res);
    });

    router.post("/rubric", async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const values: RubricValues = {};
        const errors: Record<string, string> = {};
        const read = (name: string) => {
            const value = typeof body[name] === "string" ? (body[name] as string).trim() : "";
            values[name] = value;
            if (value === "") errors[name] = "Required";
            return value;
        };

        const unit = {one: read("unitOne"), many: read("unitMany")};
        const categories: Category[] = content.get().rubric.categories.map((c) => {
            const [name, question, level0, level1, level3, level5, weightText, awardName, awardFor] =
                CATEGORY_FIELDS.map((f) => read(categoryField(c.id, f)));
            const weight = Number(weightText);
            const weightName = categoryField(c.id, "weight");
            if (!errors[weightName] && !(/^\d+$/.test(weightText) && weight >= 1 && weight <= 10)) {
                errors[weightName] = WEIGHT_ERROR;
            }
            const levels = {0: level0, 1: level1, 3: level3, 5: level5};
            return {id: c.id, name, question, levels, weight, award: {name: awardName, for: awardFor}};
        });
        if (Object.keys(errors).length > 0) return render(req, res, {values, errors}, 400);

        const result = await content.saveRubric({unit, categories});
        if (!result.ok) return render(req, res, {values, topError: SOMETHING_WENT_WRONG}, 500);
        res.redirect(302, withDone("/admin/rubric", "saved"));
    });

    return router;
}
