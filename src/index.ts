import {startApp} from "./app.js";
import {loadAppEnv} from "./lib/env.js";
import LoggerService from "./services/logger-service.js";

const env = loadAppEnv();
const log = new LoggerService(env.NODE_ENV, env.LOG_LEVEL);

startApp(env, log);
