import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * We store the upload in memory (as a Buffer) so we can pipe it
 * straight into the CSV parser without touching the filesystem.
 */
const storage = multer.memoryStorage();


function csvFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback
): void {
  const allowedMimeTypes = [
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
  ];

  const hasValidMime = allowedMimeTypes.includes(file.mimetype);
  const hasValidExtension = file.originalname.toLowerCase().endsWith(".csv");

  (hasValidMime || hasValidExtension) ? 
    callback(null, true) : 
    callback(new Error(`Only CSV files are accepted. Received: ${file.mimetype}`));

}

// Re-configured Multer instance for the import endpoint
export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: csvFilter,
});