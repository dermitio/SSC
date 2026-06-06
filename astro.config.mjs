import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  server: {
    host: "0.0.0.0"
  }
});
