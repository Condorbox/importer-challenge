import { createApp } from "./app";

const PORT = process.env.PORT_QUERY ?? 3002;

const app = createApp();

app.listen(PORT, () => {
  console.log(`[query] Service running on http://localhost:${PORT}`);
});
