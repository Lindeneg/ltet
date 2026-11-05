import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type {RawStatement} from "../lib/content.js";
import type {Statement as StatementModel, StatementHistory as HistoryModel} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type StatementRecord = Omit<StatementModel, "body"> & {body: RawStatement};

export type HistoryRecord = Omit<HistoryModel, "body"> & {body: RawStatement};

export type StatementWithHistory = StatementRecord & {history: HistoryRecord[]};

export type SaveOpts = {origin: string; published?: boolean; note?: MaybeNull<string>};

function parsed<T extends {body: string}>(row: T): Omit<T, "body"> & {body: RawStatement} {
    return {...row, body: JSON.parse(row.body) as RawStatement};
}

class StatementRepository {
    constructor(private readonly db: DataService) {}

    countByCeo(): AsyncResult<Map<string, number>, DbError> {
        return this.db.run(
            "statement-repo.countByCeo",
            this.db.p.statement
                .groupBy({by: ["ceo"], _count: {_all: true}})
                .then((rows) => new Map(rows.map((row) => [row.ceo, row._count._all])))
        );
    }

    has(id: string): AsyncResult<boolean, DbError> {
        return this.db.run(
            "statement-repo.has",
            this.db.p.statement.count({where: {id}}).then((count) => count > 0)
        );
    }

    listPublished(): AsyncResult<RawStatement[], DbError> {
        return this.db.run(
            "statement-repo.listPublished",
            this.db.p.statement
                .findMany({where: {published: true}, orderBy: [{date: "asc"}, {id: "asc"}], select: {body: true}})
                .then((rows) => rows.map((row) => JSON.parse(row.body) as RawStatement))
        );
    }

    listAll(): AsyncResult<StatementRecord[], DbError> {
        return this.db.run(
            "statement-repo.listAll",
            this.db.p.statement.findMany({orderBy: [{date: "desc"}, {id: "asc"}]}).then((rows) => rows.map(parsed))
        );
    }

    get(id: string): AsyncResult<MaybeNull<StatementWithHistory>, DbError> {
        return this.db.run(
            "statement-repo.get",
            this.db.p.statement
                .findUnique({where: {id}, include: {history: {orderBy: {id: "desc"}}}})
                .then((row) => (row ? {...parsed(row), history: row.history.map(parsed)} : null))
        );
    }

    seed(statements: RawStatement[]): AsyncResult<number, DbError> {
        return this.db.run(
            "statement-repo.seed",
            this.db.p.statement
                .createMany({
                    data: statements.map((s) => ({
                        id: s.id,
                        ceo: s.ceo,
                        date: s.date,
                        body: JSON.stringify(s),
                        origin: "seed",
                    })),
                })
                .then((result) => result.count)
        );
    }

    // resolves to true when the statement was new
    save(body: RawStatement, {origin, published = true, note = null}: SaveOpts): AsyncResult<boolean, DbError> {
        const json = JSON.stringify(body);
        return this.db.run(
            "statement-repo.save",
            this.db.p.$transaction(async (tx) => {
                const old = await tx.statement.findUnique({where: {id: body.id}});
                if (!old) {
                    await tx.statement.create({
                        data: {id: body.id, ceo: body.ceo, date: body.date, body: json, published, origin},
                    });
                    return true;
                }
                await tx.statementHistory.create({
                    data: {statementId: old.id, body: old.body, published: old.published, note},
                });
                await tx.statement.update({
                    where: {id: body.id},
                    data: {ceo: body.ceo, date: body.date, body: json, published},
                });
                return false;
            })
        );
    }

    // resolves to false when no statement has the id
    setPublished(id: string, published: boolean, note: MaybeNull<string> = null): AsyncResult<boolean, DbError> {
        return this.db.run(
            "statement-repo.setPublished",
            this.db.p.$transaction(async (tx) => {
                const old = await tx.statement.findUnique({where: {id}});
                if (!old) return false;
                await tx.statementHistory.create({
                    data: {statementId: id, body: old.body, published: old.published, note},
                });
                await tx.statement.update({where: {id}, data: {published}});
                return true;
            })
        );
    }
}

export default StatementRepository;
