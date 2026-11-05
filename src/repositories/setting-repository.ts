import type {AsyncResult} from "../lib/result.js";
import type {DbError} from "../lib/errors.js";
import type {MaybeNull} from "../lib/types.js";
import type DataService from "../services/data-service.js";

class SettingRepository {
    constructor(private readonly db: DataService) {}

    get(key: string): AsyncResult<MaybeNull<string>, DbError> {
        return this.db.run(
            "setting-repo.get",
            this.db.p.setting.findUnique({where: {key}}).then((row) => row?.value ?? null)
        );
    }

    set(key: string, value: string): AsyncResult<void, DbError> {
        return this.db.run(
            "setting-repo.set",
            this.db.p.setting.upsert({where: {key}, create: {key, value}, update: {value}}).then(() => undefined)
        );
    }
}

export default SettingRepository;
