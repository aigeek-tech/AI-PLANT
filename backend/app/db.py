from contextlib import contextmanager

from psycopg import connect
from psycopg.rows import dict_row

from .settings.config import get_settings


@contextmanager
def get_connection():
    connection = connect(get_settings().database_url, row_factory=dict_row)
    try:
        yield connection
    finally:
        connection.close()


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())


def fetch_one(sql: str, params: tuple = ()) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()


def execute_one(sql: str, params: tuple = ()) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            row = cursor.fetchone()
        connection.commit()
        return row
