import type {Standing} from "./score.js";
import type {MaybeNull} from "./types.js";

export type SnapshotRow = {id: string; total: number; pos: number; tied: boolean};

export type SnapshotEntry = {id: string; total: number; added: number; pos: MaybeNull<number>; tied: boolean};

export type Snapshot = {
    time: number;
    year: number;
    month: number;
    inPlay: boolean;
    byId: Map<string, SnapshotRow>;
    all: SnapshotEntry[];
    totalById: Map<string, number>;
    addedById: Map<string, number>;
};

export function buildSnapshots(standings: Standing[], {from, to}: {from: number; to: number}): Snapshot[] {
    if (!(to >= from)) return [];
    const end = to;
    const first = new Date(from);
    const order = new Map(standings.map((row, index) => [row.ceo.id, index]));
    const snapshots: Snapshot[] = [];
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth();
    for (;;) {
        const monthEnd = Date.UTC(year, month + 1, 1) - 1;
        const time = Math.min(monthEnd, end);
        const totals = standings.map((row) => ({
            id: row.ceo.id,
            total: row.own.reduce((sum, s) => (s.time <= time ? sum + s.forks : sum), 0),
        }));
        const onTable = totals.filter((t) => t.total > 0);
        const rows = onTable
            .map((t) => ({
                ...t,
                pos: 1 + onTable.filter((o) => o.total > t.total).length,
                tied: onTable.filter((o) => o.total === t.total).length > 1,
            }))
            .sort((a, b) => a.pos - b.pos || order.get(a.id)! - order.get(b.id)!);
        const previous = snapshots.at(-1);
        const all = totals
            .map((t) => {
                const row = rows.find((r) => r.id === t.id);
                return {
                    ...t,
                    added: t.total - (previous?.totalById.get(t.id) ?? 0),
                    pos: row?.pos ?? null,
                    tied: row?.tied ?? false,
                };
            })
            .sort((a, b) => b.total - a.total || order.get(a.id)! - order.get(b.id)!);
        snapshots.push({
            time,
            year,
            month,
            inPlay: monthEnd > end,
            byId: new Map(rows.map((r) => [r.id, r])),
            all,
            totalById: new Map(totals.map((t) => [t.id, t.total])),
            addedById: new Map(all.map((t) => [t.id, t.added])),
        });
        if (monthEnd >= end) break;
        month += 1;
        if (month === 12) {
            month = 0;
            year += 1;
        }
    }
    return snapshots;
}
