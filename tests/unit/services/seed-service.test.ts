import {mkdir, mkdtemp, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import bcrypt from "bcrypt";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {failure, success} from "../../../src/lib/result.js";
import {AppError} from "../../../src/lib/errors.js";
import SeedService, {SeedError} from "../../../src/services/seed-service.js";
import type SeedRepository from "../../../src/repositories/seed-repository.js";
import type StatementRepository from "../../../src/repositories/statement-repository.js";
import type UserRepository from "../../../src/repositories/user-repository.js";
import type ContenderRepository from "../../../src/repositories/contender-repository.js";
import type RubricRepository from "../../../src/repositories/rubric-repository.js";
import {fake, makeContent, makeStatement} from "../helpers.js";

const admin = {email: " Owner@Example.com", name: "Ada Owner", password: "a long password"};

describe("SeedService.min", () => {
    let dir: string;
    let seedPhotosDir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ltet-seed-"));
        seedPhotosDir = join(dir, "seed");
        await mkdir(seedPhotosDir);
        await writeFile(join(seedPhotosDir, "altman.jpg"), "jpeg");
        await writeFile(join(seedPhotosDir, "notes.txt"), "text");
    });

    afterEach(() => rm(dir, {recursive: true, force: true}));

    function setup(empty = true) {
        const repos = {
            isEmpty: vi.fn().mockResolvedValue(success(empty)),
            statements: vi.fn().mockResolvedValue(success(1)),
            user: vi.fn().mockResolvedValue(success({})),
            contenders: vi.fn().mockImplementation(async (ceos: unknown[]) => success(ceos.length)),
            rubric: vi.fn().mockResolvedValue(success(undefined)),
        };
        const printed: string[] = [];
        const service = new SeedService({
            seedRepo: fake<SeedRepository>({isEmpty: repos.isEmpty}),
            statementRepo: fake<StatementRepository>({seed: repos.statements}),
            userRepo: fake<UserRepository>({create: repos.user}),
            contenderRepo: fake<ContenderRepository>({seed: repos.contenders}),
            rubricRepo: fake<RubricRepository>({seed: repos.rubric}),
            photosDir: join(dir, "photos"),
            seedPhotosDir,
            bcryptRounds: 4,
            print: (line) => printed.push(line),
        });
        return {service, repos, printed};
    }

    const seed = () => ({...makeContent(), statements: [makeStatement()]});

    it("fills an empty database with the photos, contenders, rubric, admin and statements", async () => {
        const {service, repos, printed} = setup();
        const data = seed();

        expect(await service.min(admin, data)).toEqual(success(undefined));

        expect(await readdir(join(dir, "photos"))).toEqual(["altman.jpg"]);
        expect(repos.contenders).toHaveBeenCalledWith(data.ceos);
        expect(repos.rubric).toHaveBeenCalledWith(data.rubric);
        const user = repos.user.mock.calls[0][0];
        expect(user).toMatchObject({email: "owner@example.com", name: "Ada Owner", role: "ADMIN", tokenVersion: 0});
        expect(await bcrypt.compare(admin.password, user.password)).toBe(true);
        expect(repos.statements).toHaveBeenCalledWith(data.statements);
        expect(printed).toEqual([
            `Copied 1 photos into ${join(dir, "photos")}.`,
            "Seeded 2 contenders.",
            "Seeded the rubric.",
            "Seeded the admin owner@example.com.",
            "Seeded 1 statements.",
        ]);
    });

    it("refuses a database that holds anything", async () => {
        const {service, repos} = setup(false);

        expect(await service.min(admin, seed())).toEqual(failure(SeedError.NOT_EMPTY));

        expect(repos.contenders).not.toHaveBeenCalled();
        expect(repos.user).not.toHaveBeenCalled();
        expect(repos.statements).not.toHaveBeenCalled();
        await expect(readdir(join(dir, "photos"))).rejects.toThrow();
    });

    it("stops when the database can't be read", async () => {
        const {service, repos} = setup();
        repos.isEmpty.mockResolvedValue(failure(AppError.DB_ERROR));

        expect(await service.min(admin, seed())).toEqual(failure(`Failed to read the database: ${AppError.DB_ERROR}`));
        expect(repos.contenders).not.toHaveBeenCalled();
    });

    it("seeds no contenders when the photos can't be copied", async () => {
        const {service, repos} = setup();
        await rm(seedPhotosDir, {recursive: true});

        const result = await service.min(admin, seed());

        expect(result.ok).toBe(false);
        expect(repos.contenders).not.toHaveBeenCalled();
    });

    it("seeds no statements when the admin can't be added", async () => {
        const {service, repos} = setup();
        repos.user.mockResolvedValue(failure(AppError.DB_ERROR));

        expect((await service.min(admin, seed())).ok).toBe(false);
        expect(repos.statements).not.toHaveBeenCalled();
    });
});
