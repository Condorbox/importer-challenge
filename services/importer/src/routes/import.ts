import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { upload } from "../middleware/upload";
import { RATE_LIMIT_CONFIG } from "../config";
import { ApiResponse, ParsedCsvResult } from "../types/csv.types";
import { CsvValidationError, parseCsvBuffer } from "../utils/csv_parser";

export const importRouter = Router();

const uploadRateLimit = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.windowMs,
  max: RATE_LIMIT_CONFIG.max,
  standardHeaders: true, // Return RateLimit-* headers
  legacyHeaders: false,
  message: { success: false, error: RATE_LIMIT_CONFIG.message },
});

// POST /import
// Accepts a multipart/form-data request with a CSV in the "file" field.
importRouter.post(
  "/upload",
  uploadRateLimit,
  // Multer runs first, rejects oversized / wrong-type files before our code
  (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (err) => {
      if (err) {
        // Multer errors (size limit, wrong type) become clean 400s
        const response: ApiResponse<never> = {
          success: false,
          error: err.message,
        };
        res.status(400).json(response);
        return;
      }
      next();
    });
  },

  (req: Request, res: Response): void => {
    if (!req.file) {
      const response: ApiResponse<never> = {
        success: false,
        error:
          "No file uploaded. Send the CSV as multipart/form-data with field name 'file'.",
      };
      res.status(400).json(response);
      return;
    }

    try {
      const result = parseCsvBuffer(req.file.buffer, req.file.originalname);

      const response: ApiResponse<ParsedCsvResult> = {
        success: true,
        data: result,
      };

      // 207 Multi-Status when some rows were skipped due to format errors
      const status = result.skippedRows > 0 ? 207 : 200;
      res.status(status).json(response);
    } catch (err) {
      if (err instanceof CsvValidationError) {
        const response: ApiResponse<never> = {
          success: false,
          error: err.message,
        };
        res.status(422).json(response);
        return;
      }

      // Unexpected error
      throw err;
    }
  },
);
