import {loadSeedEnv} from "./lib/env.js";
import {loadContent, readSeed} from "./lib/content.js";
import {photosDir, SEED_PHOTOS_DIR} from "./lib/paths.js";
import LoggerService from "./services/logger-service.js";
import DataService from "./services/data-service.js";
import SeedService from "./services/seed-service.js";
import SeedRepository from "./repositories/seed-repository.js";
import StatementRepository from "./repositories/statement-repository.js";
import UserRepository from "./repositories/user-repository.js";
import ContenderRepository from "./repositories/contender-repository.js";
import RubricRepository from "./repositories/rubric-repository.js";

const env = loadSeedEnv();
if (!env.SUPER_USER) {
    console.error("SUPER_USER must be set, as email,firstname,lastname,password.");
    process.exit(1);
}

const dataService = new DataService(env.DATABASE_URL, "production", new LoggerService("production"));
const seeder = new SeedService({
    seedRepo: new SeedRepository(dataService),
    statementRepo: new StatementRepository(dataService),
    userRepo: new UserRepository(dataService),
    contenderRepo: new ContenderRepository(dataService),
    rubricRepo: new RubricRepository(dataService),
    photosDir: photosDir(env.DATABASE_URL),
    seedPhotosDir: SEED_PHOTOS_DIR,
    bcryptRounds: env.BCRYPT_ROUNDS,
    print: (line) => console.log(line),
});

const seeded = await seeder.min(env.SUPER_USER, {...(await loadContent()), statements: await readSeed()});
await dataService.teardown();
if (!seeded.ok) {
    console.error(seeded.ctx);
    process.exitCode = 1;
}
