import { defineHandler } from "void";
import { storage } from "void/storage";
import { isShareId } from "../../../../src/share-schema";

export const GET = defineHandler(async (c) => {
  const id = c.req.param("id");
  if (!isShareId(id)) {
    return c.notFound();
  }

  const object = await storage.get(`shares/${id}.json`);
  if (!object) {
    return c.notFound();
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
  });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});
