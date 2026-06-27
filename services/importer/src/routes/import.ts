import { Router, Request, Response, NextFunction } from "express";
import { upload } from "../middleware/upload";

export const importRouter = Router();

// POST /import
// Accepts a multipart/form-data request with a CSV in the "file" field.
importRouter.post(
  "/",
  upload.single("file"),
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded. Send a CSV as the "file" form field.' });
      return;
    }

    // req.file.buffer          the raw CSV bytes, ready for the parser
    // req.file.originalname    original filename from the client
    // req.file.size            byte size
    console.info(`[import] Received file: ${req.file.originalname} (${req.file.size} bytes)`);

    // TODO parser 
    res.status(200).json({
      message: "File received successfully.",
      filename: req.file.originalname,
      sizeBytes: req.file.size,
    });
  }
);