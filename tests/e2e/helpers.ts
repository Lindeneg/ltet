import {randomUUID} from "node:crypto";
import {loadAppEnv, loadSeedEnv} from "../../src/lib/env.js";
import type {MaybeNull} from "../../src/lib/types.js";
import DataService from "../../src/services/data-service.js";
import LoggerService from "../../src/services/logger-service.js";

export const env = loadAppEnv();
const seedEnv = loadSeedEnv();
if (!seedEnv.SUPER_USER) throw new Error("SUPER_USER must be set in .env.test");
export const superUser = seedEnv.SUPER_USER;

export const BASE_URL = `http://localhost:${env.PORT}`;

export const db = new DataService(env.DATABASE_URL, env.NODE_ENV, new LoggerService(env.NODE_ENV));

export type TestResponse = {
    status: number;
    location: MaybeNull<string>;
    setCookies: string[];
    headers: Headers;
    html: string;
};

async function request(path: string, init: RequestInit, cookie?: string): Promise<TestResponse> {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const res = await fetch(BASE_URL + path, {...init, headers, redirect: "manual"});
    return {
        status: res.status,
        location: res.headers.get("location"),
        setCookies: res.headers.getSetCookie(),
        headers: res.headers,
        html: await res.text(),
    };
}

export function get(path: string, cookie?: string): Promise<TestResponse> {
    return request(path, {method: "GET"}, cookie);
}

export function postForm(
    path: string,
    fields: Record<string, string>,
    cookie?: string,
    headers: Record<string, string> = {origin: BASE_URL}
): Promise<TestResponse> {
    return request(path, {method: "POST", body: new URLSearchParams(fields), headers}, cookie);
}

export function cookieFrom(res: TestResponse): string | undefined {
    return res.setCookies.find((c) => c.startsWith(`${env.JWT_COOKIE_NAME}=`))?.split(";")[0];
}

export async function login(password = superUser.password): Promise<string> {
    const res = await postForm("/admin/login", {email: superUser.email, password});
    const cookie = cookieFrom(res);
    if (res.status !== 302 || !cookie) throw new Error(`login failed with status ${res.status}`);
    return cookie;
}

export function uid(): string {
    return randomUUID().slice(0, 8);
}
