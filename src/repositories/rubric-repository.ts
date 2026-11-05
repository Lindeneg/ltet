import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {Category, Rubric} from "../lib/content.js";
import type {MaybeNull} from "../lib/types.js";
import type DataService from "../services/data-service.js";

const RUBRIC_ID = 1;

export type RubricEdit = Pick<Rubric, "unit" | "categories">;

const levelColumns = ({levels}: Category) => ({
    level0: levels[0],
    level1: levels[1],
    level3: levels[3],
    level5: levels[5],
});

class RubricRepository {
    constructor(private readonly db: DataService) {}

    get(): AsyncResult<MaybeNull<Rubric>, DbError> {
        return this.db.run(
            "rubric-repo.get",
            Promise.all([
                this.db.p.rubric.findUnique({where: {id: RUBRIC_ID}}),
                this.db.p.category.findMany({orderBy: {position: "asc"}}),
            ]).then(([row, categories]) =>
                row
                    ? {
                          maxPerCategory: row.maxPerCategory,
                          unit: {one: row.unitOne, many: row.unitMany},
                          categories: categories.map((c) => ({
                              id: c.id,
                              name: c.name,
                              question: c.question,
                              levels: {0: c.level0, 1: c.level1, 3: c.level3, 5: c.level5},
                              weight: c.weight,
                              award: {name: c.awardName, for: c.awardFor},
                          })),
                          titles: {
                              first: row.titleFirst,
                              last: row.titleLast,
                              topStatement: {name: row.topStatementName, for: row.topStatementFor},
                          },
                      }
                    : null
            )
        );
    }

    save({unit, categories}: RubricEdit): AsyncResult<void, DbError> {
        return this.db.run(
            "rubric-repo.save",
            this.db.p
                .$transaction([
                    this.db.p.rubric.update({where: {id: RUBRIC_ID}, data: {unitOne: unit.one, unitMany: unit.many}}),
                    ...categories.map((c) =>
                        this.db.p.category.update({
                            where: {id: c.id},
                            data: {
                                name: c.name,
                                question: c.question,
                                ...levelColumns(c),
                                weight: c.weight,
                                awardName: c.award.name,
                                awardFor: c.award.for,
                            },
                        })
                    ),
                ])
                .then(() => undefined)
        );
    }

    seed(rubric: Rubric): AsyncResult<void, DbError> {
        return this.db.run(
            "rubric-repo.seed",
            this.db.p
                .$transaction([
                    this.db.p.rubric.create({
                        data: {
                            id: RUBRIC_ID,
                            maxPerCategory: rubric.maxPerCategory,
                            unitOne: rubric.unit.one,
                            unitMany: rubric.unit.many,
                            titleFirst: rubric.titles.first,
                            titleLast: rubric.titles.last,
                            topStatementName: rubric.titles.topStatement.name,
                            topStatementFor: rubric.titles.topStatement.for,
                        },
                    }),
                    this.db.p.category.deleteMany(),
                    this.db.p.category.createMany({
                        data: rubric.categories.map((c, position) => ({
                            id: c.id,
                            position,
                            name: c.name,
                            question: c.question,
                            ...levelColumns(c),
                            weight: c.weight,
                            awardName: c.award.name,
                            awardFor: c.award.for,
                        })),
                    }),
                ])
                .then(() => undefined)
        );
    }
}

export default RubricRepository;
