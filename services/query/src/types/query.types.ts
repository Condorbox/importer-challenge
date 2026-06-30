export type FilterOperator = "eq" | "gte" | "lte" | "contains";
export type SortDirection = "asc" | "desc";

export interface PaginationConfig {
  defaultPage: number;
  defaultLimit: number;
  maxLimit: number;
}

export interface ParsedFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface ParsedSort {
  field: string;
  direction: SortDirection;
}

export interface ParsedPagination {
  page: number;
  limit: number;
  offset: number;
}

export interface ParsedQuery {
  filters: ParsedFilter[];
  sort?: ParsedSort;
  pagination: ParsedPagination;
}
