import type {Category, Ceo, RawStatement, Rubric} from "./content.js";

export type Contender = Ceo & {shortName: string};

export type ScoredStatement = RawStatement & {
    forks: number;
    who: Contender;
    time: number;
};

export type Standing = {
    ceo: Contender;
    own: ScoredStatement[];
    total: number;
    byCategory: Record<string, number>;
};

export type Tally = {statements: ScoredStatement[]; standings: Standing[]};

export function points(statement: RawStatement, category: Category): number {
    return statement.scores[category.id].score * category.weight;
}

export function maxPitchforks(rubric: Rubric): number {
    return rubric.categories.reduce((sum, category) => sum + rubric.maxPerCategory * category.weight, 0);
}

export function tally(ceos: Ceo[], rubric: Rubric, rawStatements: RawStatement[]): Tally {
    const categories = rubric.categories;
    const ceoById = new Map(ceos.map((ceo) => [ceo.id, {...ceo, shortName: ceo.name.split(" ").at(-1) ?? ceo.name}]));
    const statements = rawStatements
        .map((s) => ({
            ...s,
            forks: Math.round(categories.reduce((sum, c) => sum + points(s, c), 0)),
            who: ceoById.get(s.ceo)!,
            time: Date.parse(`${s.date}T00:00:00Z`),
        }))
        .sort((a, b) => a.time - b.time);

    const standings = [...ceoById.values()]
        .map((ceo) => {
            const own = statements.filter((s) => s.ceo === ceo.id);
            return {
                ceo,
                own,
                total: own.reduce((sum, s) => sum + s.forks, 0),
                byCategory: Object.fromEntries(
                    categories.map((c) => [c.id, own.reduce((sum, s) => sum + points(s, c), 0)])
                ),
            };
        })
        .sort((a, b) => b.total - a.total || a.ceo.name.localeCompare(b.ceo.name));

    return {statements, standings};
}
