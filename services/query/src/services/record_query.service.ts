import { db } from "@shared/db/client";
import type { ImportColumn } from "@shared/db/schema";
import type { ParsedQuery } from "../types/query.types";
import {
  RecordRepository,
  type FindRecordsResult,
} from "../repositories/record.repository";
import { buildRecordQuery } from "./record_query.builder";

const repository = new RecordRepository(db);

export async function findColumnsByImportId(
  importId: number,
): Promise<ImportColumn[]> {
  return repository.findColumnsByImportId(importId);
}

export async function importExists(importId: number): Promise<boolean> {
  return repository.importExists(importId);
}

export async function findRecords(
  importId: number,
  parsed: ParsedQuery,
  columnsByName: Map<string, ImportColumn>,
): Promise<FindRecordsResult> {
  return repository.findRecords(importId, parsed, columnsByName);
}

export { buildRecordQuery };
