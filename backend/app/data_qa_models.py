from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


DataQaAggregation = Literal["count", "count_distinct", "sum", "avg", "min", "max"]
DataQaFilterOperator = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "in",
    "gte",
    "lte",
    "gt",
    "lt",
    "is_null",
    "not_null",
]
DataQaSortDirection = Literal["asc", "desc"]
DataQaChartType = Literal["bar", "column", "line", "pie", "table"]


_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class DataQaMeasure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    aggregation: DataQaAggregation = "count"
    alias: str | None = None

    @field_validator("field")
    @classmethod
    def normalize_field(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Field must use lowercase letters, numbers, and underscores")
        return normalized

    @field_validator("alias")
    @classmethod
    def normalize_alias(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Identifier must use lowercase letters, numbers, and underscores")
        return normalized


class DataQaFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    operator: DataQaFilterOperator = "eq"
    value: object | None = None

    @field_validator("field")
    @classmethod
    def normalize_field(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Field must be a whitelisted identifier")
        return normalized


class DataQaSort(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    direction: DataQaSortDirection = "asc"

    @field_validator("field")
    @classmethod
    def normalize_field(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Sort field must be a whitelisted identifier")
        return normalized


class DataQaChart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: DataQaChartType = "table"
    x: str | None = None
    y: str | None = None

    @field_validator("x", "y")
    @classmethod
    def normalize_optional_field(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            return None
        if not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Chart field must be a whitelisted identifier")
        return normalized


class DataQaQueryPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset: str
    dimensions: list[str] = Field(default_factory=list, max_length=6)
    measures: list[DataQaMeasure] = Field(default_factory=list, max_length=6)
    filters: list[DataQaFilter] = Field(default_factory=list, max_length=12)
    sort: list[DataQaSort] = Field(default_factory=list, max_length=4)
    limit: int = Field(default=100, ge=1, le=500)
    chart: DataQaChart | None = None

    @field_validator("dataset")
    @classmethod
    def normalize_dataset(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized or not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Dataset must be a whitelisted identifier")
        return normalized

    @field_validator("dimensions")
    @classmethod
    def normalize_dimensions(cls, value: list[str]) -> list[str]:
        normalized_dimensions: list[str] = []
        for item in value:
            normalized = str(item).strip().lower()
            if not normalized or not _IDENTIFIER_RE.match(normalized):
                raise ValueError("Dimension must be a whitelisted identifier")
            if normalized not in normalized_dimensions:
                normalized_dimensions.append(normalized)
        return normalized_dimensions


class DataQaSqlDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    success: bool = True
    dataset: str | None = None
    sql: str | None = None
    tables: list[str] = Field(default_factory=list, max_length=16)
    chart_type: DataQaChartType = Field(default="table", alias="chart-type")
    chart: DataQaChart | None = None
    brief: str | None = None
    message: str | None = None

    @field_validator("dataset")
    @classmethod
    def normalize_optional_dataset(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized or not _IDENTIFIER_RE.match(normalized):
            raise ValueError("Dataset must be a whitelisted identifier")
        return normalized

    @field_validator("sql")
    @classmethod
    def normalize_sql(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if len(normalized) > 20000:
            raise ValueError("SQL is too long")
        return normalized

    @field_validator("tables")
    @classmethod
    def normalize_tables(cls, value: list[str]) -> list[str]:
        normalized_tables: list[str] = []
        for item in value:
            normalized = str(item).strip().lower()
            if not normalized:
                continue
            if not _IDENTIFIER_RE.match(normalized):
                raise ValueError("Table names must be whitelisted identifiers")
            if normalized not in normalized_tables:
                normalized_tables.append(normalized)
        return normalized_tables

    @field_validator("brief", "message")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def require_sql_when_successful(self) -> "DataQaSqlDraft":
        if self.success:
            if not self.dataset:
                raise ValueError("Successful SQL draft must include dataset")
            if not self.sql:
                raise ValueError("Successful SQL draft must include sql")
        elif not self.message:
            raise ValueError("Failed SQL draft must include message")
        return self
