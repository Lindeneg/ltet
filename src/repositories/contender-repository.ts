import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {Ceo} from "../lib/content.js";
import type {MaybeNull} from "../lib/types.js";
import type {Contender} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type ContenderRecord = Contender;

export type ContenderFields = Omit<Contender, "id" | "position">;

export const photoPath = (id: string) => `assets/ceos/${id}.jpg`;

export function toCeo(row: Contender, hasPhoto: boolean): Ceo {
    const ceo: Ceo = {id: row.id, name: row.name, company: row.company};
    if (!hasPhoto) return ceo;
    ceo.photo = {
        file: photoPath(row.id),
        author: row.photoAuthor ?? "",
        licence: row.photoLicence ?? "",
        source: row.photoSource ?? "",
        changes: row.photoChanges ?? "",
    };
    if (row.photoLicenceUrl !== null) ceo.photo.licenceUrl = row.photoLicenceUrl;
    return ceo;
}

class ContenderRepository {
    constructor(private readonly db: DataService) {}

    list(): AsyncResult<ContenderRecord[], DbError> {
        return this.db.run("contender-repo.list", this.db.p.contender.findMany({orderBy: {position: "asc"}}));
    }

    get(id: string): AsyncResult<MaybeNull<ContenderRecord>, DbError> {
        return this.db.run("contender-repo.get", this.db.p.contender.findUnique({where: {id}}));
    }

    create(id: string, fields: ContenderFields): AsyncResult<void, DbError> {
        return this.db.run(
            "contender-repo.create",
            this.db.p.$transaction(async (tx) => {
                // created before the read so the transaction holds the write lock and never fails busy
                await tx.contender.create({data: {id, position: 0, ...fields}});
                const last = await tx.contender.aggregate({where: {id: {not: id}}, _max: {position: true}});
                await tx.contender.update({where: {id}, data: {position: (last._max.position ?? -1) + 1}});
            })
        );
    }

    update(id: string, fields: ContenderFields): AsyncResult<boolean, DbError> {
        return this.db.run(
            "contender-repo.update",
            this.db.p.contender.updateMany({where: {id}, data: fields}).then((result) => result.count > 0)
        );
    }

    delete(id: string): AsyncResult<boolean, DbError> {
        return this.db.run(
            "contender-repo.delete",
            this.db.p.contender.deleteMany({where: {id}}).then((result) => result.count > 0)
        );
    }

    seed(ceos: Ceo[]): AsyncResult<number, DbError> {
        return this.db.run(
            "contender-repo.seed",
            this.db.p.contender
                .createMany({
                    data: ceos.map((ceo, position) => ({
                        id: ceo.id,
                        name: ceo.name,
                        company: ceo.company,
                        position,
                        photoAuthor: ceo.photo?.author ?? null,
                        photoLicence: ceo.photo?.licence ?? null,
                        photoLicenceUrl: ceo.photo?.licenceUrl ?? null,
                        photoSource: ceo.photo?.source ?? null,
                        photoChanges: ceo.photo?.changes ?? null,
                    })),
                })
                .then((result) => result.count)
        );
    }
}

export default ContenderRepository;
