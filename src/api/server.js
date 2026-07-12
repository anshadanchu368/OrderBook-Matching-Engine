import { createApp } from "./app.js";

export async function startApiServer({ port = process.env.PORT ?? 3000 } = {}) {
  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[api] listening on port ${port}`);
      resolve(server);
    });

    server.once("error", reject);
  });
}
