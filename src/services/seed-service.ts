import {copyFile, mkdir, readdir} from "node:fs/promises";
import {join} from "node:path";
import bcrypt from "bcrypt";
import {success, failure, type AsyncResult} from "../lib/result.js";
import type {Content, RawStatement} from "../lib/content.js";
import type SeedRepository from "../repositories/seed-repository.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type UserRepository from "../repositories/user-repository.js";
import type ContenderRepository from "../repositories/contender-repository.js";
import type RubricRepository from "../repositories/rubric-repository.js";
import {normalizeEmail} from "./auth-service.js";

export type Admin = {email: string; name: string; password: string};

export type Seed = Content & {statements: RawStatement[]};

export type SeedDeps = {
    seedRepo: SeedRepository;
    statementRepo: StatementRepository;
    userRepo: UserRepository;
    contenderRepo: ContenderRepository;
    rubricRepo: RubricRepository;
    photosDir: string;
    seedPhotosDir: string;
    bcryptRounds: number;
    print: (line: string) => void;
};

export const SeedError = {
    NOT_EMPTY: "The database already holds data. seed:min only fills an empty one.",
} as const;

class SeedService {
    constructor(private readonly deps: SeedDeps) {}

    async min(admin: Admin, seed: Seed): AsyncResult<void, string> {
        const {seedRepo, statementRepo, contenderRepo, rubricRepo, print} = this.deps;
        const empty = await seedRepo.isEmpty();
        if (!empty.ok) return failure(`Failed to read the database: ${empty.ctx}`);
        if (!empty.data) return failure(SeedError.NOT_EMPTY);

        const photos = await this.#copyPhotos();
        if (!photos.ok) return photos;
        print(`Copied ${photos.data} photos into ${this.deps.photosDir}.`);

        const contenders = await contenderRepo.seed(seed.ceos);
        if (!contenders.ok) return failure(`Failed to seed the contenders: ${contenders.ctx}`);
        print(`Seeded ${contenders.data} contenders.`);

        const rubric = await rubricRepo.seed(seed.rubric);
        if (!rubric.ok) return failure(`Failed to seed the rubric: ${rubric.ctx}`);
        print("Seeded the rubric.");

        const added = await this.addAdmin(admin);
        if (!added.ok) return added;
        print(`Seeded the admin ${normalizeEmail(admin.email)}.`);

        const statements = await statementRepo.seed(seed.statements);
        if (!statements.ok) return failure(`Failed to seed the statements: ${statements.ctx}`);
        print(`Seeded ${statements.data} statements.`);
        return success(undefined);
    }

    async addAdmin({email, name, password}: Admin): AsyncResult<void, string> {
        const created = await this.deps.userRepo.create({
            email: normalizeEmail(email),
            name,
            password: await bcrypt.hash(password, this.deps.bcryptRounds),
            role: "ADMIN",
            tokenVersion: 0,
        });
        return created.ok ? success(undefined) : failure(`Failed to add the admin ${email}: ${created.ctx}`);
    }

    async #copyPhotos(): AsyncResult<number, string> {
        const {photosDir, seedPhotosDir} = this.deps;
        try {
            await mkdir(photosDir, {recursive: true});
            const files = (await readdir(seedPhotosDir)).filter((file) => file.endsWith(".jpg"));
            await Promise.all(files.map((file) => copyFile(join(seedPhotosDir, file), join(photosDir, file))));
            return success(files.length);
        } catch (err) {
            return failure(`Failed to copy the photos into ${photosDir}: ${(err as Error).message}`);
        }
    }
}

export default SeedService;
