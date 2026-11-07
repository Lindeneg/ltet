import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import ContentService, {ContentError} from "../../../src/services/content-service.js";
import type ContenderRepository from "../../../src/repositories/contender-repository.js";
import type RubricRepository from "../../../src/repositories/rubric-repository.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type ProposalRepository from "../../../src/repositories/proposal-repository.js";
import type {ContenderRecord} from "../../../src/repositories/contender-repository.js";
import type {Ceo} from "../../../src/lib/content.js";
import {fake, fakeLog, makeContent} from "../helpers.js";

function record(ceo: Ceo, position: number): ContenderRecord {
    return {
        id: ceo.id,
        name: ceo.name,
        company: ceo.company,
        position,
        photoAuthor: ceo.photo?.author ?? null,
        photoLicence: ceo.photo?.licence ?? null,
        photoLicenceUrl: ceo.photo?.licenceUrl ?? null,
        photoSource: ceo.photo?.source ?? null,
        photoChanges: ceo.photo?.changes ?? null,
    };
}

const fields = {
    name: "New One",
    company: "Co",
    photoAuthor: null,
    photoLicence: null,
    photoLicenceUrl: null,
    photoSource: null,
    photoChanges: null,
};

function setup(dir: string, {rubric = makeContent().rubric as unknown} = {}) {
    const contenderRepo = {
        list: vi.fn().mockResolvedValue(success(makeContent().ceos.map(record))),
        get: vi.fn().mockResolvedValue(success(null)),
        create: vi.fn().mockResolvedValue(success(undefined)),
        update: vi.fn().mockResolvedValue(success(true)),
        delete: vi.fn().mockResolvedValue(success(true)),
    };
    const rubricRepo = {
        get: vi.fn().mockResolvedValue(success(rubric)),
        save: vi.fn().mockResolvedValue(success(undefined)),
    };
    const statementRepo = {countByCeo: vi.fn().mockResolvedValue(success(new Map([["altman", 2]])))};
    const proposalRepo = {openFor: vi.fn().mockResolvedValue(success(0))};
    const onChange = vi.fn();
    const log = fakeLog();
    const service = new ContentService(
        fake<ContenderRepository>(contenderRepo),
        fake<RubricRepository>(rubricRepo),
        fake<StatementRepository>(statementRepo),
        fake<ProposalRepository>(proposalRepo),
        join(dir, "photos"),
        onChange,
        log
    );
    return {service, contenderRepo, rubricRepo, statementRepo, proposalRepo, onChange, log};
}

describe("ContentService", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ltet-content-"));
    });

    afterEach(() => rm(dir, {recursive: true, force: true}));

    it("throws when read before it is loaded", () => {
        const {service} = setup(dir);

        expect(() => service.get()).toThrow();
    });

    it("loads the contenders and the rubric", async () => {
        const {service} = setup(dir);

        expect(await service.load()).toEqual(success(makeContent()));
        expect(service.get()).toEqual(makeContent());
    });

    it("fails to load without a rubric", async () => {
        const {service} = setup(dir, {rubric: null});

        expect(await service.load()).toEqual(failure(AppError.NOT_FOUND));
    });

    describe("writes", () => {
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 1]);
        const photo = () => join(dir, "photos", "new-one.jpg");

        it("gives a contender a photo only when its file is in the store", async () => {
            const {service} = setup(dir);
            await mkdir(join(dir, "photos"));
            await writeFile(join(dir, "photos", "musk.jpg"), jpeg);

            await service.load();

            expect(service.get().ceos.map((ceo) => ceo.photo?.file)).toEqual([undefined, "assets/ceos/musk.jpg"]);
        });

        it("creates a contender with its photo, reloads and calls onChange", async () => {
            const {service, contenderRepo, onChange} = setup(dir);

            expect(await service.createContender("new-one", fields, jpeg)).toEqual(success(undefined));
            expect(contenderRepo.create).toHaveBeenCalledWith("new-one", fields);
            expect(await readFile(photo())).toEqual(jpeg);
            expect(contenderRepo.list).toHaveBeenCalled();
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("refuses an id that exists and leaves its photo alone", async () => {
            const {service, contenderRepo} = setup(dir);
            contenderRepo.get.mockResolvedValue(success(record(makeContent().ceos[0], 0)));

            expect(await service.createContender("altman", fields, jpeg)).toEqual(failure(ContentError.EXISTS));
            expect(existsSync(join(dir, "photos", "altman.jpg"))).toBe(false);
        });

        it("takes the photo back when the row can't be created", async () => {
            const {service, contenderRepo, onChange} = setup(dir);
            contenderRepo.create.mockResolvedValue(failure(AppError.CONFLICT));

            expect(await service.createContender("new-one", fields, jpeg)).toEqual(failure(ContentError.EXISTS));
            expect(existsSync(photo())).toBe(false);
            expect(onChange).not.toHaveBeenCalled();
        });

        it("updates and replaces, keeps or removes the photo", async () => {
            const {service, contenderRepo} = setup(dir);
            contenderRepo.get.mockResolvedValue(success(record(makeContent().ceos[0], 0)));

            await service.updateContender("new-one", fields, jpeg);
            expect(await readFile(photo())).toEqual(jpeg);
            await service.updateContender("new-one", fields, undefined);
            expect(existsSync(photo())).toBe(true);
            await service.updateContender("new-one", fields, null);
            expect(existsSync(photo())).toBe(false);
            expect(contenderRepo.update).toHaveBeenCalledTimes(3);
        });

        describe("when the update fails", () => {
            const old = Buffer.from("old photo");

            async function failing(update: unknown) {
                const ctx = setup(dir);
                ctx.contenderRepo.get.mockResolvedValue(success(record(makeContent().ceos[0], 0)));
                ctx.contenderRepo.update.mockResolvedValue(update);
                return ctx;
            }

            async function oldPhoto() {
                await mkdir(join(dir, "photos"), {recursive: true});
                await writeFile(photo(), old);
            }

            it("restores the old photo when the update fails", async () => {
                const {service, onChange} = await failing(failure(AppError.DB_ERROR));
                await oldPhoto();

                expect(await service.updateContender("new-one", fields, jpeg)).toEqual(failure(AppError.DB_ERROR));
                expect(await readFile(photo())).toEqual(old);
                expect(onChange).not.toHaveBeenCalled();
            });

            it("restores the old photo when the contender is gone by the update", async () => {
                const {service} = await failing(success(false));
                await oldPhoto();

                expect(await service.updateContender("new-one", fields, jpeg)).toEqual(failure(ContentError.NOT_FOUND));
                expect(await readFile(photo())).toEqual(old);
            });

            it("removes a new photo when the update fails", async () => {
                const {service} = await failing(failure(AppError.DB_ERROR));

                await service.updateContender("new-one", fields, jpeg);
                expect(existsSync(photo())).toBe(false);
            });

            it("puts a removed photo back when the update fails", async () => {
                const {service} = await failing(failure(AppError.DB_ERROR));
                await oldPhoto();

                await service.updateContender("new-one", fields, null);
                expect(await readFile(photo())).toEqual(old);
            });

            it("leaves the photo alone when the update fails", async () => {
                const {service} = await failing(failure(AppError.DB_ERROR));
                await oldPhoto();

                await service.updateContender("new-one", fields, undefined);
                expect(await readFile(photo())).toEqual(old);
            });

            it("changes no photo it can't first read", async () => {
                const {service, contenderRepo, log} = await failing(success(true));
                await mkdir(photo(), {recursive: true});

                expect(await service.updateContender("new-one", fields, jpeg)).toEqual(failure(ContentError.PHOTOS));
                expect(contenderRepo.update).not.toHaveBeenCalled();
                expect(log.error).toHaveBeenCalled();
            });
        });

        it("updates no unknown contender", async () => {
            const {service, contenderRepo} = setup(dir);

            expect(await service.updateContender("nobody", fields, jpeg)).toEqual(failure(ContentError.NOT_FOUND));
            expect(contenderRepo.update).not.toHaveBeenCalled();
        });

        it("deletes a contender without statements, with its photo", async () => {
            const {service, contenderRepo, onChange} = setup(dir);
            await mkdir(join(dir, "photos"));
            await writeFile(photo(), jpeg);

            expect(await service.deleteContender("new-one")).toEqual(success(undefined));
            expect(contenderRepo.delete).toHaveBeenCalledWith("new-one");
            expect(existsSync(photo())).toBe(false);
            expect(onChange).toHaveBeenCalledOnce();
        });

        it("keeps a contender with statements, hidden ones included", async () => {
            const {service, contenderRepo} = setup(dir);

            expect(await service.deleteContender("altman")).toEqual(failure(ContentError.IN_USE));
            expect(contenderRepo.delete).not.toHaveBeenCalled();
        });

        it("keeps a contender with open proposals", async () => {
            const {service, contenderRepo, proposalRepo} = setup(dir);
            proposalRepo.openFor.mockResolvedValue(success(1));

            expect(await service.blockers("new-one")).toEqual(success({statements: 0, proposals: 1}));
            expect(await service.deleteContender("new-one")).toEqual(failure(ContentError.IN_USE));
            expect(proposalRepo.openFor).toHaveBeenCalledWith("new-one");
            expect(contenderRepo.delete).not.toHaveBeenCalled();
        });

        it("saves a rubric with the same categories in the same order", async () => {
            const {service, rubricRepo, onChange} = setup(dir);
            await service.load();
            const {unit, categories} = makeContent().rubric;

            expect(await service.saveRubric({unit, categories})).toEqual(success(undefined));
            expect(rubricRepo.save).toHaveBeenCalledWith({unit, categories});
            expect(onChange).toHaveBeenCalledOnce();

            expect(await service.saveRubric({unit, categories: [...categories].reverse()})).toEqual(
                failure(ContentError.INVALID)
            );
            expect(await service.saveRubric({unit, categories: categories.slice(1)})).toEqual(
                failure(ContentError.INVALID)
            );
        });
    });
});
