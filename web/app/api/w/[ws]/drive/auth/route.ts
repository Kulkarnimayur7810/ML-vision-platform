import { wsHandler } from "@/lib/api";
import { generateGoogleAuthUrl } from "@/lib/server/google-drive";

export const GET = wsHandler("datasets.edit", async (_req, c) => {
  const url = generateGoogleAuthUrl(c.slug, c.user.id);
  return { url };
});
