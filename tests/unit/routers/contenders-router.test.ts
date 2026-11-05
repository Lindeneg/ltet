import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {contendersRouter} from "../../../src/routers/admin/contenders.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type ContentService from "../../../src/services/content-service.js";
import type PreviewService from "../../../src/services/preview-service.js";
import {ContentError} from "../../../src/services/content-service.js";
import {fake, makeCeo, makeContent} from "../helpers.js";
import {fakeProposalService, serveAdmin} from "./admin-app.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("contenders router", () => {
    let service: {
        get: Mock;
        hasPhoto: Mock;
        createContender: Mock;
        updateContender: Mock;
        deleteContender: Mock;
        blockers: Mock;
    };
    let canDraw: Mock;
    let repo: {countByCeo: Mock};
    let app: Awaited<ReturnType<typeof serveAdmin>>;

    const multipart = (path: string, fields: Record<string, string>, photo?: Buffer) => {
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) form.append(name, value);
        if (photo) form.append("photo", new Blob([new Uint8Array(photo)], {type: "image/jpeg"}), "face.jpg");
        return fetch(`${app.url}${path}`, {method: "POST", body: form, redirect: "manual"});
    };

    beforeEach(async () => {
        const photographed = makeCeo({
            photo: {
                file: "assets/ceos/altman.jpg",
                author: "A",
                licence: "CC BY 4.0",
                source: "https://a.example",
                changes: "cropped",
            },
        });
        service = {
            get: vi.fn().mockReturnValue(makeContent({ceos: [photographed, makeCeo({id: "musk", name: "Elon Musk"})]})),
            hasPhoto: vi.fn((id: string) => id === "altman"),
            createContender: vi.fn().mockResolvedValue(success(undefined)),
            updateContender: vi.fn().mockResolvedValue(success(undefined)),
            deleteContender: vi.fn().mockResolvedValue(success(undefined)),
            blockers: vi.fn((id: string) =>
                Promise.resolve(success({statements: id === "altman" ? 3 : 0, proposals: 0}))
            ),
        };
        canDraw = vi.fn().mockResolvedValue(true);
        repo = {countByCeo: vi.fn().mockResolvedValue(success(new Map([["altman", 3]])))};
        app = await serveAdmin(
            contendersRouter(
                fake<ContentService>(service),
                fake<StatementRepository>(repo),
                fakeProposalService().service,
                fake<PreviewService>({canDraw})
            )
        );
    });

    afterEach(() => app.close());

    it("shows the photo or the crest in the list", async () => {
        const html = await (await app.get("/admin/contenders")).text();

        expect(html).toContain(`<img class="thumb" src="/assets/ceos/altman.jpg"`);
        expect(html).toContain(`<span class="thumb crest" aria-hidden="true">EM</span>`);
        expect(html).toContain(`<td data-label="Statements" class="num">0</td>`);
    });

    it("says something went wrong when the counts can't load", async () => {
        repo.countByCeo.mockResolvedValue(failure("db_error"));

        const res = await app.get("/admin/contenders");

        expect(res.status).toBe(500);
        expect(await res.text()).toContain("Something went wrong.");
    });

    it("creates with the trimmed fields and empty credits as null", async () => {
        const res = await multipart("/admin/contenders", {
            id: "new-one",
            name: " New One ",
            company: "Co",
            photoChanges: " ",
        });

        expect(res.status).toBe(302);
        expect(service.createContender).toHaveBeenCalledWith(
            "new-one",
            {
                name: "New One",
                company: "Co",
                photoAuthor: null,
                photoLicence: null,
                photoLicenceUrl: null,
                photoSource: null,
                photoChanges: null,
            },
            undefined
        );
    });

    it("reserves the id new for the new form's path", async () => {
        const res = await multipart("/admin/contenders", {id: "new", name: "New", company: "Co"});

        expect(res.status).toBe(400);
        expect(await res.text()).toContain("That id is reserved.");
        expect(service.createContender).not.toHaveBeenCalled();
    });

    it("keeps the form when saving fails", async () => {
        service.createContender.mockResolvedValue(failure(ContentError.PHOTOS));

        const res = await multipart("/admin/contenders", {id: "new-one", name: "Typed", company: "Co"});

        expect(res.status).toBe(500);
        const html = await res.text();
        expect(html).toContain("Something went wrong.");
        expect(html).toContain(`value="Typed"`);
    });

    it("keeps the photo when nothing is uploaded and nothing ticked", async () => {
        await multipart("/admin/contenders/altman", {
            name: "Sam",
            company: "OpenAI",
            photoAuthor: "A",
            photoLicence: "L",
            photoSource: "https://a.example",
        });

        expect(service.updateContender.mock.calls[0][2]).toBeUndefined();
    });

    it("removes the photo when ticked, and needs no credits then", async () => {
        const res = await multipart("/admin/contenders/altman", {name: "Sam", company: "OpenAI", removePhoto: "1"});

        expect(res.status).toBe(302);
        expect(service.updateContender.mock.calls[0][2]).toBeNull();
    });

    it("lets an upload win over the remove tick", async () => {
        await multipart(
            "/admin/contenders/altman",
            {
                name: "Sam",
                company: "OpenAI",
                photoAuthor: "A",
                photoLicence: "L",
                photoSource: "https://a.example",
                removePhoto: "1",
            },
            JPEG
        );

        expect(service.updateContender.mock.calls[0][2]).toEqual(JPEG);
    });

    it("asks for credits for a kept photo", async () => {
        const res = await multipart("/admin/contenders/altman", {name: "Sam", company: "OpenAI"});

        expect(res.status).toBe(400);
        expect(await res.text()).toContain("A photo needs its author, licence and source");
        expect(service.updateContender).not.toHaveBeenCalled();
    });

    it("has no edit page or save for an unknown contender", async () => {
        expect((await app.get("/admin/contenders/nobody")).status).toBe(404);
        expect((await multipart("/admin/contenders/nobody", {name: "X", company: "Y"})).status).toBe(404);
    });

    it("shows the delete button only without statements", async () => {
        expect(await (await app.get("/admin/contenders/altman")).text()).toContain(
            "Has 3 statements, so it can't be deleted."
        );
        expect(await (await app.get("/admin/contenders/musk")).text()).toContain("Delete contender");
    });

    it("says has 1 statement for one", async () => {
        service.blockers.mockResolvedValue(success({statements: 1, proposals: 0}));

        expect(await (await app.get("/admin/contenders/altman")).text()).toContain(
            "Has 1 statement, so it can't be deleted."
        );
    });

    it("names the open proposals, alone or with the statements", async () => {
        service.blockers.mockResolvedValue(success({statements: 0, proposals: 1}));
        expect(await (await app.get("/admin/contenders/musk")).text()).toContain(
            "Has 1 open proposal, so it can't be deleted."
        );

        service.blockers.mockResolvedValue(success({statements: 2, proposals: 3}));
        expect(await (await app.get("/admin/contenders/musk")).text()).toContain(
            "Has 2 statements and 3 open proposals, so it can't be deleted."
        );
    });

    it("refuses a photo the previews can't draw", async () => {
        canDraw.mockResolvedValue(false);

        const res = await multipart(
            "/admin/contenders",
            {
                id: "new-one",
                name: "N",
                company: "Co",
                photoAuthor: "A",
                photoLicence: "L",
                photoSource: "https://a.example",
            },
            JPEG
        );

        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Upload a JPEG");
        expect(service.createContender).not.toHaveBeenCalled();
    });

    it("maps a refused delete", async () => {
        service.deleteContender.mockResolvedValue(failure(ContentError.IN_USE));
        expect((await app.post("/admin/contenders/altman/delete", {})).status).toBe(409);

        service.deleteContender.mockResolvedValue(failure(ContentError.NOT_FOUND));
        expect((await app.post("/admin/contenders/nobody/delete", {})).status).toBe(404);
    });
});
