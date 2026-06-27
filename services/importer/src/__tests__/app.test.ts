import request from "supertest";
import { createApp } from "../app";

const app = createApp();

// The route and error handler intentionally log on every request
// (console.info on success, console.error on rejected uploads).
// That's expected behavior, not a test failure — silence it so
// test output isn't cluttered with logs from negative-path tests.
beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /import", () => {
  it("returns 400 when no file is attached", async () => {
    const res = await request(app).post("/import");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
    expect(res.body.error).toMatch(/file/);
  });

  it("accepts a .csv file and echoes filename + size", async () => {
    const csvContent = "id,name\n1,Alice\n2,Bob\n";
    const buffer = Buffer.from(csvContent, "utf-8");

    const res = await request(app).post("/import").attach("file", buffer, {
      filename: "contacts.csv",
      contentType: "text/csv",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "File received successfully.",
      filename: "contacts.csv",
      sizeBytes: buffer.length,
    });
  });

  it("accepts a file with a .csv extension even if the mimetype is generic", async () => {
    // e.g. some OSes/browsers send octet-stream for unrecognized types
    const buffer = Buffer.from("a,b,c\n1,2,3\n", "utf-8");

    const res = await request(app).post("/import").attach("file", buffer, {
      filename: "data.csv",
      contentType: "application/octet-stream",
    });

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("data.csv");
  });

  it("accepts a file with an allowed mimetype even without a .csv extension", async () => {
    // covers the `hasValidMime || hasValidExtension` branch from the other side
    const buffer = Buffer.from("a,b,c\n1,2,3\n", "utf-8");

    const res = await request(app).post("/import").attach("file", buffer, {
      filename: "data.txt",
      contentType: "text/csv",
    });

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("data.txt");
  });

  it("rejects a non-CSV file with 400", async () => {
    const buffer = Buffer.from("not a csv", "utf-8");

    const res = await request(app).post("/import").attach("file", buffer, {
      filename: "photo.png",
      contentType: "image/png",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Only CSV files are accepted");
  });

  it("rejects a file larger than the 50 MB limit with 413", async () => {
    const oversized = Buffer.alloc(50 * 1024 * 1024 + 1, "a");

    const res = await request(app).post("/import").attach("file", oversized, {
      filename: "huge.csv",
      contentType: "text/csv",
    });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "File exceeds the 50 MB limit." });
  }, 15000);

  it("ignores unexpected form fields and still processes the file", async () => {
    const buffer = Buffer.from("id,name\n1,Alice\n", "utf-8");

    const res = await request(app)
      .post("/import")
      .field("notes", "this field is not used by the route")
      .attach("file", buffer, {
        filename: "contacts.csv",
        contentType: "text/csv",
      });

    expect(res.status).toBe(200);
  });
});
