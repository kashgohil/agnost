import { Elysia } from "elysia";

import { getClustersOverview } from "./queries.ts";

export const clustersRoutes = new Elysia({ prefix: "/v1/clusters" }).get("/", async () => {
  return await getClustersOverview();
});
