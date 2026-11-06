import {createCipheriv, createDecipheriv, hkdfSync, randomBytes} from "node:crypto";
import type {MaybeNull} from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function deriveKey(secret: string, purpose: string): Buffer {
    return Buffer.from(hkdfSync("sha256", secret, "ltet", purpose, 32));
}

export function seal(key: Buffer, plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, {authTagLength: TAG_BYTES});
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function open(key: Buffer, sealed: string): MaybeNull<string> {
    const bytes = Buffer.from(sealed, "base64");
    if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
    try {
        const decipher = createDecipheriv(ALGORITHM, key, bytes.subarray(0, IV_BYTES), {authTagLength: TAG_BYTES});
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
            "utf8"
        );
    } catch {
        return null;
    }
}
