import { createApp } from "./app";

const PORT = process.env.PORT_IMPORT ?? 3001;

const app = createApp();

app.listen(PORT, () => {
  console.log(`[importer] Service running on http://localhost:${PORT}`);
});
