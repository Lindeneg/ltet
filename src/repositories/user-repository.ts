import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {RawModel, MaybeNull} from "../lib/types.js";
import type {User as UserModel} from "../generated/prisma/client.js";
import type DataService from "../services/data-service.js";

export type User = Omit<UserModel, "password">;
export type UserWithPassword = UserModel;

export const userOmit = {password: true} as const;

class UserRepository {
    constructor(private readonly db: DataService) {}

    get(id: string): AsyncResult<MaybeNull<User>, DbError> {
        return this.db.run("user-repo.get", this.db.p.user.findUnique({where: {id}, omit: userOmit}));
    }

    getWithPasswordById(id: string): AsyncResult<MaybeNull<UserWithPassword>, DbError> {
        return this.db.run("user-repo.getWithPasswordById", this.db.p.user.findUnique({where: {id}}));
    }

    getWithPasswordByEmail(email: string): AsyncResult<MaybeNull<UserWithPassword>, DbError> {
        return this.db.run("user-repo.getWithPasswordByEmail", this.db.p.user.findUnique({where: {email}}));
    }

    create(data: RawModel<UserWithPassword>): AsyncResult<User, DbError> {
        return this.db.run("user-repo.create", this.db.p.user.create({data, omit: userOmit}));
    }

    bumpTokenVersion(id: string): AsyncResult<User, DbError> {
        return this.db.run(
            "user-repo.bumpTokenVersion",
            this.db.p.user.update({where: {id}, data: {tokenVersion: {increment: 1}}, omit: userOmit})
        );
    }

    updatePassword(id: string, hash: string): AsyncResult<User, DbError> {
        return this.db.run(
            "user-repo.updatePassword",
            this.db.p.user.update({
                where: {id},
                data: {password: hash, tokenVersion: {increment: 1}},
                omit: userOmit,
            })
        );
    }
}

export default UserRepository;
