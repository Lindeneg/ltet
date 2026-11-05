import {Router, type Request, type RequestHandler, type Response} from "express";
import multer from "multer";
import z from "zod";
import {send} from "../../lib/http.js";
import {isUrl} from "../../lib/statement-rules.js";
import {fieldErrors} from "../../lib/validation.js";
import type {ContenderFields} from "../../repositories/contender-repository.js";
import type StatementRepository from "../../repositories/statement-repository.js";
import {ContentError, type PhotoChange} from "../../services/content-service.js";
import type ContentService from "../../services/content-service.js";
import type ProposalService from "../../services/proposal-service.js";
import type PreviewService from "../../services/preview-service.js";
import {
    CONTENDER_FIELDS,
    ContenderView,
    contenderValues,
    type ContenderValues,
    type ContenderViewProps,
} from "../../ui/views/admin/contender.js";
import {ContendersView} from "../../ui/views/admin/contenders.js";
import {SOMETHING_WENT_WRONG, adminPage, sendError, withDone} from "./respond.js";

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const NO_CONTENDER = "No contender with that id.";
const NOT_A_URL = "Must be a link starting with http:// or https://";
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

const text = (max: number) => z.string().trim().min(1, "Required").max(max, `At most ${max} characters`);
const optional = z.string().trim().catch("");
const optionalUrl = optional.refine((value) => value === "" || isUrl(value), NOT_A_URL);

const IdSchema = text(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single dashes")
    .refine((id) => id !== "new", "That id is reserved.");

const FieldsSchema = z.object({
    name: text(100),
    company: text(100),
    photoAuthor: optional,
    photoLicence: optional,
    photoLicenceUrl: optionalUrl,
    photoSource: optionalUrl,
    photoChanges: optional,
});

type Upload = {photo?: Buffer; error?: string};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {fileSize: PHOTO_MAX_BYTES, files: 1, fields: CONTENDER_FIELDS.length + 1},
}).single("photo");

const readUpload =
    (previewService: PreviewService): RequestHandler =>
    (req, res, next) => {
        upload(req, res, async (err: unknown) => {
            const result: Upload = {};
            if (err instanceof multer.MulterError) {
                result.error = err.code === "LIMIT_FILE_SIZE" ? "At most 2 MB" : SOMETHING_WENT_WRONG;
            } else if (err) {
                return next(err);
            } else if (req.file && req.file.size > 0) {
                const photo = req.file.buffer;
                const jpeg = photo.subarray(0, 3).equals(JPEG_START) && (await previewService.canDraw(photo));
                if (jpeg) result.photo = photo;
                else result.error = "Upload a JPEG";
            }
            res.locals.upload = result;
            next();
        });
    };

function typed(body: Record<string, unknown>): Partial<ContenderValues> {
    const values: Partial<ContenderValues> = {};
    for (const name of CONTENDER_FIELDS) {
        if (typeof body[name] === "string") values[name] = body[name];
    }
    return values;
}

const orNull = (value: string) => (value === "" ? null : value);

type Parsed = {ok: true; fields: ContenderFields} | {ok: false; errors: Record<string, string>};

function parseFields(body: unknown, upload: Upload, willHavePhoto: boolean): Parsed {
    const parsed = FieldsSchema.safeParse(body ?? {});
    const errors = parsed.success ? {} : fieldErrors(parsed.error);
    if (upload.error) errors.photo = upload.error;
    if (parsed.success && willHavePhoto) {
        const {photoAuthor, photoLicence, photoSource} = parsed.data;
        if (!photoAuthor || !photoLicence || !photoSource) {
            errors.photo ??= "A photo needs its author, licence and source";
        }
    }
    if (!parsed.success || Object.keys(errors).length > 0) return {ok: false, errors};
    const data = parsed.data;
    return {
        ok: true,
        fields: {
            name: data.name,
            company: data.company,
            photoAuthor: orNull(data.photoAuthor),
            photoLicence: orNull(data.photoLicence),
            photoLicenceUrl: orNull(data.photoLicenceUrl),
            photoSource: orNull(data.photoSource),
            photoChanges: orNull(data.photoChanges),
        },
    };
}

export function contendersRouter(
    content: ContentService,
    statementRepo: StatementRepository,
    proposalService: ProposalService,
    previewService: PreviewService
): Router {
    const router = Router();

    const pathOf = (id: string) => `/admin/contenders/${encodeURIComponent(id)}`;
    const ceoOf = (id: string) => content.get().ceos.find((ceo) => ceo.id === id);

    async function render(
        req: Request,
        res: Response,
        props: Omit<ContenderViewProps, "page">,
        status = 200
    ): Promise<void> {
        send(res, ContenderView({page: await adminPage(req, proposalService, "contenders"), ...props}), status);
    }

    async function renderEdit(
        req: Request,
        res: Response,
        id: string,
        props: Partial<ContenderViewProps> = {},
        status = 200
    ) {
        const ceo = ceoOf(id);
        if (!ceo) return sendError(res, await adminPage(req, proposalService, "contenders"), NO_CONTENDER, 404);
        const blockers = await content.blockers(id);
        if (!blockers.ok)
            return sendError(res, await adminPage(req, proposalService, "contenders"), SOMETHING_WENT_WRONG, 500);
        await render(
            req,
            res,
            {values: contenderValues(ceo), ...props, existing: {ceo, blockers: blockers.data}},
            status
        );
    }

    router.get("/contenders", async (req, res) => {
        const page = await adminPage(req, proposalService, "contenders");
        const counts = await statementRepo.countByCeo();
        if (!counts.ok) return sendError(res, page, SOMETHING_WENT_WRONG, 500);
        send(res, ContendersView({page, ceos: content.get().ceos, counts: counts.data}));
    });

    router.get("/contenders/new", async (req, res) => {
        await render(req, res, {values: contenderValues()});
    });

    router.post("/contenders", readUpload(previewService), async (req, res) => {
        const upload = res.locals.upload as Upload;
        const values = contenderValues(undefined, typed(req.body ?? {}));
        const id = IdSchema.safeParse(req.body?.id);
        const parsed = parseFields(req.body, upload, upload.photo !== undefined);
        if (!id.success || !parsed.ok) {
            const errors = {
                ...(parsed.ok ? {} : parsed.errors),
                ...(id.success ? {} : {id: id.error.issues[0].message}),
            };
            return render(req, res, {values, errors}, 400);
        }
        const result = await content.createContender(id.data, parsed.fields, upload.photo);
        if (!result.ok) {
            if (result.ctx === ContentError.EXISTS) {
                return render(req, res, {values, errors: {id: "A contender with this id exists already"}}, 409);
            }
            return render(req, res, {values, topError: SOMETHING_WENT_WRONG}, 500);
        }
        res.redirect(302, withDone(pathOf(id.data), "added"));
    });

    router.get("/contenders/:id", async (req, res) => {
        await renderEdit(req, res, req.params.id);
    });

    router.post("/contenders/:id", readUpload(previewService), async (req, res) => {
        const id = String(req.params.id);
        const ceo = ceoOf(id);
        if (!ceo) return sendError(res, await adminPage(req, proposalService, "contenders"), NO_CONTENDER, 404);
        const upload = res.locals.upload as Upload;
        const values = contenderValues(ceo, typed(req.body ?? {}));
        const remove = req.body?.removePhoto === "1";
        const photo: PhotoChange = upload.photo ?? (remove ? null : undefined);
        const willHavePhoto = upload.photo !== undefined || (!remove && content.hasPhoto(id));
        const parsed = parseFields(req.body, upload, willHavePhoto);
        if (!parsed.ok) return renderEdit(req, res, id, {values, errors: parsed.errors}, 400);
        const result = await content.updateContender(id, parsed.fields, photo);
        if (!result.ok) {
            if (result.ctx === ContentError.NOT_FOUND) {
                return sendError(res, await adminPage(req, proposalService, "contenders"), NO_CONTENDER, 404);
            }
            return renderEdit(req, res, id, {values, topError: SOMETHING_WENT_WRONG}, 500);
        }
        res.redirect(302, withDone(pathOf(id), "saved"));
    });

    router.post("/contenders/:id/delete", async (req, res) => {
        const id = req.params.id;
        const result = await content.deleteContender(id);
        if (!result.ok) {
            if (result.ctx === ContentError.NOT_FOUND) {
                return sendError(res, await adminPage(req, proposalService, "contenders"), NO_CONTENDER, 404);
            }
            if (result.ctx === ContentError.IN_USE) return renderEdit(req, res, id, {}, 409);
            return renderEdit(req, res, id, {topError: SOMETHING_WENT_WRONG}, 500);
        }
        res.redirect(302, withDone("/admin/contenders", "deleted"));
    });

    return router;
}
