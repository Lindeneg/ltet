import {spawn} from "node:child_process";
import {once} from "node:events";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {readSeed, type RawStatement} from "../../src/lib/content.js";
import {AppError} from "../../src/lib/errors.js";
import {failure, success} from "../../src/lib/result.js";
import ContenderRepository from "../../src/repositories/contender-repository.js";
import StatementRepository from "../../src/repositories/statement-repository.js";
import {db, env, uid} from "./helpers.js";

const statements = new StatementRepository(db);
const contenders = new ContenderRepository(db);
const PREFIX = `altman-2026-01-02-db-${uid()}`;
let seed: RawStatement[];

beforeAll(async () => {
    seed = await readSeed();
});

afterAll(async () => {
    await db.p.statement.deleteMany({where: {id: {startsWith: PREFIX}}});
    await db.p.proposal.deleteMany({where: {body: {contains: PREFIX}}});
});

function newStatement(): RawStatement {
    const id = `${PREFIX}-${uid()}`;
    return {...seed[0], id, ceo: "altman", date: "2026-01-02"};
}

async function propose(statement: RawStatement) {
    const row = await db.p.proposal.create({
        data: {kind: "statement", origin: "scout", body: JSON.stringify(statement)},
    });
    return row.id;
}

const statusOf = async (id: number) => (await db.p.proposal.findUniqueOrThrow({where: {id}})).status;

async function holdWriteLock(ms: number) {
    const script = `
        const db = new (require("better-sqlite3"))(process.argv[1]);
        db.exec("BEGIN IMMEDIATE");
        db.prepare("INSERT INTO Setting (key, value) VALUES ('e2e-lock', 'held')").run();
        db.prepare("DELETE FROM Setting WHERE key = 'e2e-lock'").run();
        process.stdout.write("held");
        setTimeout(() => db.exec("COMMIT"), Number(process.argv[2]));
    `;
    const child = spawn(process.execPath, ["-e", script, env.DATABASE_URL.replace(/^file:/, ""), String(ms)]);
    await once(child.stdout, "data");
    return {released: once(child, "exit")};
}

describe("approving a proposed statement", () => {
    it("publishes the statement and closes the proposal together", async () => {
        const statement = newStatement();
        const proposal = await propose(statement);

        expect(await statements.approve(proposal, statement, "scout")).toEqual(success(true));
        expect(await statusOf(proposal)).toBe("approved");
        expect(await statements.has(statement.id)).toEqual(success(true));
    });

    it("saves nothing when the proposal was closed before the commit", async () => {
        const statement = newStatement();
        const proposal = await propose(statement);
        await db.p.proposal.update({where: {id: proposal}, data: {status: "rejected"}});

        expect(await statements.approve(proposal, statement, "scout")).toEqual(success(false));
        expect(await statements.has(statement.id)).toEqual(success(false));
        expect(await statusOf(proposal)).toBe("rejected");
    });

    it("leaves the proposal open when the id was taken before the commit", async () => {
        const statement = newStatement();
        const proposal = await propose(statement);
        await statements.save(statement, {origin: "cms"});

        expect(await statements.approve(proposal, statement, "scout")).toEqual(failure(AppError.CONFLICT));
        expect(await statusOf(proposal)).toBe("open");
    });

    it("approves once when sent twice", async () => {
        const statement = newStatement();
        const proposal = await propose(statement);

        const both = await Promise.all([
            statements.approve(proposal, statement, "scout"),
            statements.approve(proposal, statement, "scout"),
        ]);

        expect(both).toEqual(expect.arrayContaining([success(true), success(false)]));
        expect(await db.p.statement.count({where: {id: statement.id}})).toBe(1);
    });
});

describe("a write while another connection holds the lock", () => {
    it("waits for it and succeeds", async () => {
        const existing = newStatement();
        await statements.save(existing, {origin: "cms"});
        const approved = newStatement();
        const proposal = await propose(approved);
        const contender = `db-${uid()}`;

        const writes: Array<() => Promise<{ok: boolean}>> = [
            () => statements.save({...existing, context: "Edited under a lock."}, {origin: "cms", note: "busy"}),
            () => statements.setPublished(existing.id, false, "busy"),
            () => statements.approve(proposal, approved, "scout"),
            () =>
                contenders.create(contender, {
                    name: "Lock Test",
                    company: "Busy Inc",
                    photoAuthor: null,
                    photoLicence: null,
                    photoLicenceUrl: null,
                    photoSource: null,
                    photoChanges: null,
                }),
        ];
        for (const write of writes) {
            const lock = await holdWriteLock(300);
            expect((await write()).ok).toBe(true);
            await lock.released;
        }

        const history = await db.p.statementHistory.findMany({where: {statementId: existing.id}});
        expect(history.map((h) => h.note)).toEqual(["busy", "busy"]);
        expect(await statusOf(proposal)).toBe("approved");
        const last = await db.p.contender.aggregate({where: {id: {not: contender}}, _max: {position: true}});
        expect((await db.p.contender.findUniqueOrThrow({where: {id: contender}})).position).toBe(
            (last._max.position ?? -1) + 1
        );
        await db.p.contender.delete({where: {id: contender}});
    });
});
