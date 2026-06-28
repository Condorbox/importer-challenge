import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import { CSV_PARSE_OPTIONS, UPLOAD_CONFIG } from "../config";

export const upload = multer({
  /**
  * We store the upload in memory (as a Buffer) so we can pipe it
  * straight into the CSV parser without touching the filesystem.
  */
  storage: multer.memoryStorage(),
 
  limits: {
    fileSize: CSV_PARSE_OPTIONS.maxFileSizeBytes,
    files: 1,
  },
 
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // Check MIME type
    const hasValidMime = UPLOAD_CONFIG.allowedMimeTypes.includes(
      file.mimetype as (typeof UPLOAD_CONFIG.allowedMimeTypes)[number]
    );
 
    // Check file extension (case-insensitive)
    const hasValidExtension = file.originalname.toLowerCase().endsWith(".csv");
 
    if (!hasValidMime || !hasValidExtension) {
      // Passing an Error to cb rejects the file and sends a 400
      cb(new Error(`Invalid file type. Only .csv files are accepted.`));
      return;
    }
 
    cb(null, true);
  },
}).single(UPLOAD_CONFIG.fieldName);

