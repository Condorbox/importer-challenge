import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import type { Record_ as RecordRow } from "@shared/db/schema";
import {
  FilterTypeMismatchError,
  UnknownFieldError,
  validateFilters,
} from "../services/column.validator";
import {
  findColumnsByImportId,
  findRecords,
  importExists,
} from "../services/record_query.service";
import type { ApiResponse } from "../types/api.types";
import { PaginationConfig } from "../types/query.types";
import { parseQueryParams, QueryValidationError } from "../utils/query.parser";

export const recordsRouter = Router();

const PAGINATION_CONFIG: PaginationConfig = {
  defaultPage: 1,
  defaultLimit: 50,
  maxLimit: 500,
};

const recordsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many record query requests. Please try again later.",
  },
});

export interface RecordsResponse {
  records: RecordRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

recordsRouter.use(recordsRateLimit);

recordsRouter.get(
  "/:importId/records",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const importId = parseImportId(req.params.importId);

    if (importId === null) {
      const response: ApiResponse<never> = {
        success: false,
        error: "importId must be a positive integer.",
      };
      res.status(400).json(response);
      return;
    }

    try {
      const columns = await findColumnsByImportId(importId);

      if (columns.length === 0 && !(await importExists(importId))) {
        const response: ApiResponse<never> = {
          success: false,
          error: `Import ${importId} was not found.`,
        };
        res.status(404).json(response);
        return;
      }

      const parsed = parseQueryParams(req.query, PAGINATION_CONFIG);
      const { columnsByName } = validateFilters(
        parsed.filters,
        columns,
        parsed.sort,
      );
      const result = await findRecords(importId, parsed, columnsByName);
      const totalPages = Math.ceil(result.total / parsed.pagination.limit);

      if (result.total > 0 && parsed.pagination.page > totalPages) {
        const response: ApiResponse<never> = {
          success: false,
          error:
            `Page ${parsed.pagination.page} does not exist for this query. ` +
            `There ${totalPages === 1 ? "is" : "are"} ${totalPages} page(s) of ` +
            `results (${result.total} total, ${parsed.pagination.limit} per page).`,
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse<RecordsResponse> = {
        success: true,
        data: {
          records: result.records,
          pagination: buildPaginationEnvelope(
            parsed.pagination.page,
            parsed.pagination.limit,
            result.total,
          ),
        },
      };
      res.status(200).json(response);
    } catch (err) {
      if (err instanceof QueryValidationError) {
        const response: ApiResponse<never> = {
          success: false,
          error: err.message,
        };
        res.status(400).json(response);
        return;
      }

      if (err instanceof UnknownFieldError) {
        const response: ApiResponse<never> = {
          success: false,
          error: err.message,
          details: err.fields,
        };
        res.status(400).json(response);
        return;
      }

      if (err instanceof FilterTypeMismatchError) {
        const response: ApiResponse<never> = {
          success: false,
          error: err.message,
        };
        res.status(400).json(response);
        return;
      }

      next(err);
    }
  },
);

function parseImportId(rawValue: string | string[] | undefined): number | null {
  if (!rawValue || Array.isArray(rawValue) || !/^\d+$/.test(rawValue)) {
    return null;
  }

  const importId = Number(rawValue);
  return importId > 0 ? importId : null;
}

function buildPaginationEnvelope(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
