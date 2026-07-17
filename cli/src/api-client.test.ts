import { expect, mock, test } from "bun:test";
import { deleteUpload } from "./api-client";

test("marks bearer-authenticated deletes as JSON for Astro origin protection", async () => {
  const fetch = mock(async () => Response.json({ ok: true }));

  expect(await deleteUpload("https://dlvr.sh", "dlvr_test", "upload/id", { fetch })).toEqual({ ok: true });

  expect(fetch).toHaveBeenCalledWith("https://dlvr.sh/api/account/uploads/upload%2Fid", {
    method: "DELETE",
    headers: {
      authorization: "Bearer dlvr_test",
      "content-type": "application/json",
    },
  });
});
