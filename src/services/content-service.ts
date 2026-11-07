import {existsSync} from "node:fs";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {failure, success, type AsyncResult} from "../lib/result.js";
import {AppError, type DbError} from "../lib/errors.js";
import type {Content} from "../lib/content.js";
import type {MaybeNull, MaybeUndefined, ValueOf} from "../lib/types.js";
import type LoggerService from "./logger-service.js";
import {toCeo, type ContenderFields} from "../repositories/contender-repository.js";
import type ContenderRepository from "../repositories/contender-repository.js";
import type RubricRepository from "../repositories/rubric-repository.js";
import type {RubricEdit} from "../repositories/rubric-repository.js";
import type StatementRepository from "../repositories/statement-repository.js";
import type ProposalRepository from "../repositories/proposal-repository.js";

export const ContentError = {
    ...AppError,
    EXISTS: "exists",
    IN_USE: "in_use",
    PHOTOS: "photos",
} as const;

export type ContentError = ValueOf<typeof ContentError>;

export type Blockers = {statements: number; proposals: number};

export type PhotoChange = MaybeUndefined<MaybeNull<Buffer>>;

class ContentService {
    #content: MaybeNull<Content> = null;

    constructor(
        private readonly contenderRepo: ContenderRepository,
        private readonly rubricRepo: RubricRepository,
        private readonly statementRepo: StatementRepository,
        private readonly proposalRepo: ProposalRepository,
        private readonly photosDir: string,
        private readonly onChange: () => void,
        private readonly log: LoggerService
    ) {}

    get(): Content {
        if (!this.#content) throw new Error("the contenders and the rubric are not loaded");
        return this.#content;
    }

    hasPhoto(id: string): boolean {
        return existsSync(this.#photoFile(id));
    }

    async load(): AsyncResult<Content, DbError> {
        const [rows, rubric] = await Promise.all([this.contenderRepo.list(), this.rubricRepo.get()]);
        if (!rows.ok) return rows;
        if (!rubric.ok) return rubric;
        if (!rubric.data) return failure(AppError.NOT_FOUND);
        this.#content = {ceos: rows.data.map((row) => toCeo(row, this.hasPhoto(row.id))), rubric: rubric.data};
        return success(this.#content);
    }

    async createContender(id: string, fields: ContenderFields, photo: PhotoChange): AsyncResult<void, ContentError> {
        const existing = await this.contenderRepo.get(id);
        if (!existing.ok) return existing;
        if (existing.data) return failure(ContentError.EXISTS);
        if (photo && !(await this.#writePhoto(id, photo))) return failure(ContentError.PHOTOS);
        const created = await this.contenderRepo.create(id, fields);
        if (!created.ok) {
            if (photo) await this.#removePhoto(id);
            return failure(created.ctx === AppError.CONFLICT ? ContentError.EXISTS : created.ctx);
        }
        return this.#changed();
    }

    async updateContender(id: string, fields: ContenderFields, photo: PhotoChange): AsyncResult<void, ContentError> {
        const existing = await this.contenderRepo.get(id);
        if (!existing.ok) return existing;
        if (!existing.data) return failure(ContentError.NOT_FOUND);
        const previous = photo === undefined ? null : await this.#readPhoto(id);
        if (previous instanceof Error) return failure(ContentError.PHOTOS);
        if (photo && !(await this.#writePhoto(id, photo))) return failure(ContentError.PHOTOS);
        if (photo === null && !(await this.#removePhoto(id))) return failure(ContentError.PHOTOS);
        const updated = await this.contenderRepo.update(id, fields);
        if (!updated.ok || !updated.data) {
            if (photo !== undefined) await (previous ? this.#writePhoto(id, previous) : this.#removePhoto(id));
            return updated.ok ? failure(ContentError.NOT_FOUND) : updated;
        }
        return this.#changed();
    }

    async blockers(id: string): AsyncResult<Blockers, DbError> {
        const [counts, proposals] = await Promise.all([this.statementRepo.countByCeo(), this.proposalRepo.openFor(id)]);
        if (!counts.ok) return counts;
        if (!proposals.ok) return proposals;
        return success({statements: counts.data.get(id) ?? 0, proposals: proposals.data});
    }

    async deleteContender(id: string): AsyncResult<void, ContentError> {
        const blockers = await this.blockers(id);
        if (!blockers.ok) return blockers;
        if (blockers.data.statements > 0 || blockers.data.proposals > 0) return failure(ContentError.IN_USE);
        const deleted = await this.contenderRepo.delete(id);
        if (!deleted.ok) return deleted;
        if (!deleted.data) return failure(ContentError.NOT_FOUND);
        await this.#removePhoto(id);
        return this.#changed();
    }

    async saveRubric(edit: RubricEdit): AsyncResult<void, ContentError> {
        const known = this.get().rubric.categories.map((c) => c.id);
        const given = edit.categories.map((c) => c.id);
        if (known.length !== given.length || known.some((id, i) => id !== given[i])) {
            return failure(ContentError.INVALID);
        }
        const saved = await this.rubricRepo.save(edit);
        if (!saved.ok) return saved;
        return this.#changed();
    }

    async #changed(): AsyncResult<void, DbError> {
        const loaded = await this.load();
        this.onChange();
        return loaded.ok ? success(undefined) : loaded;
    }

    #photoFile(id: string): string {
        return join(this.photosDir, `${id}.jpg`);
    }

    async #readPhoto(id: string): Promise<MaybeNull<Buffer> | Error> {
        try {
            return await readFile(this.#photoFile(id));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
            this.log.error(err, "content-service.readPhoto");
            return err as Error;
        }
    }

    async #writePhoto(id: string, data: Buffer): Promise<boolean> {
        const file = this.#photoFile(id);
        try {
            await mkdir(this.photosDir, {recursive: true});
            await writeFile(`${file}.tmp`, data);
            await rename(`${file}.tmp`, file);
            return true;
        } catch (err) {
            this.log.error(err, "content-service.writePhoto");
            return false;
        }
    }

    async #removePhoto(id: string): Promise<boolean> {
        try {
            await rm(this.#photoFile(id), {force: true});
            return true;
        } catch (err) {
            this.log.error(err, "content-service.removePhoto");
            return false;
        }
    }
}

export default ContentService;
