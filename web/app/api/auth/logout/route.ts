import { handler } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
export const POST = handler(async () => { await destroySession(); return { ok: true }; });
