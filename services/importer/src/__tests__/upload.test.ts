import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { upload } from "../middleware/upload";

// Mock the config so we have predictable test conditions
jest.mock("../config", () => ({
  CSV_PARSE_OPTIONS: { maxFileSizeBytes: 52_428_800 }, // 50 MB
  UPLOAD_CONFIG: {
    allowedMimeTypes: ["text/csv", "application/vnd.ms-excel"],
    fieldName: "file",
  },
}));

// Create a minimal Express app to mount your middleware
const app = express();

app.post("/upload", upload, (req: Request, res: Response) => {
  res.status(200).json({ message: "File accepted", file: req.file });
});

// Add an error handler to catch the Multer rejection errors
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: err.message });
});

// Helper to streamline Supertest requests
const sendFile = (filename: string, contentType: string) => {
  return request(app)
    .post("/upload")
    .attach("file", Buffer.from("dummy data"), {
      filename,
      contentType,
    });
};

// Tests
describe("upload middleware (Integration)", () => {
  it("exports a function (multer handler)", () => {
    expect(typeof upload).toBe("function");
  });

  describe("valid files", () => {
    it("accepts text/csv with .csv extension", async () => {
      const res = await sendFile("data.csv", "text/csv");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("File accepted");
    });

    it("accepts application/vnd.ms-excel with .csv extension", async () => {
      const res = await sendFile("report.csv", "application/vnd.ms-excel");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("File accepted");
    });

    it("is case-insensitive for the file extension", async () => {
      const res = await sendFile("DATA.CSV", "text/csv");
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("File accepted");
    });
  });

  describe("invalid MIME type", () => {
    it("rejects application/json even with .csv extension", async () => {
      const res = await sendFile("data.csv", "application/json");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });

    it("rejects text/plain with .csv extension", async () => {
      const res = await sendFile("data.csv", "text/plain");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });
  });

  describe("invalid file extension", () => {
    it("rejects text/csv with .txt extension", async () => {
      const res = await sendFile("data.txt", "text/csv");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });

    it("rejects text/csv with .xlsx extension", async () => {
      const res = await sendFile("data.xlsx", "text/csv");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });

    it("rejects text/csv with no extension", async () => {
      const res = await sendFile("datafile", "text/csv");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });
  });

  describe("both MIME and extension invalid", () => {
    it("rejects image/png with .png extension", async () => {
      const res = await sendFile("photo.png", "image/png");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid file type/);
    });
  });
});
