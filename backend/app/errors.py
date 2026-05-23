from __future__ import annotations

from typing import Mapping

from fastapi import HTTPException, Request

from .i18n import request_has_explicit_locale, request_locale, translate


def localized_http_exception(
    request: Request | None,
    *,
    status_code: int,
    code: str,
    fallback: str,
    params: Mapping[str, object] | None = None,
) -> HTTPException:
    if not request_has_explicit_locale(request):
        return HTTPException(status_code=status_code, detail=fallback)

    locale = request_locale(request)
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": translate(code, locale, params),
            "params": dict(params or {}),
        },
    )
