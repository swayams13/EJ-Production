# test_cors_on_error.py
"""Confirms an unhandled exception still gets CORS headers. No pytest, no fixtures."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


def _build_app(with_handler: bool):
    app = FastAPI()

    if with_handler:
        # NOTE: deliberately NOT @app.exception_handler(Exception) — Starlette routes an
        # Exception-keyed exception_handler to ServerErrorMiddleware, which always sits
        # OUTSIDE CORSMiddleware (see Starlette's Starlette.build_middleware_stack:
        # `if key in (500, Exception): error_handler = value` feeds ServerErrorMiddleware,
        # not the user_middleware stack). Its response never passes back through CORS.
        # A BaseHTTPMiddleware added *before* CORSMiddleware (add_middleware prepends,
        # so "added first" ends up as the inner layer) sits *inside* CORS instead, so
        # the response it builds does get CORS headers applied on the way out.
        from fastapi.responses import JSONResponse
        from starlette.middleware.base import BaseHTTPMiddleware

        class _CatchAll(BaseHTTPMiddleware):
            async def dispatch(self, request, call_next):
                try:
                    return await call_next(request)
                except Exception:
                    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

        app.add_middleware(_CatchAll)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/boom")
    def boom():
        raise ValueError("kaboom")

    return app


def test_without_handler_500_has_no_cors_header():
    app = _build_app(with_handler=False)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 500
    assert "access-control-allow-origin" not in resp.headers
    print("PASS: confirmed the bug reproduces without the handler")


def test_with_handler_500_has_cors_header():
    app = _build_app(with_handler=True)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 500
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert resp.json() == {"detail": "Internal server error"}
    print("PASS: catch-all middleware makes the 500 response carry CORS headers")


test_without_handler_500_has_no_cors_header()
test_with_handler_500_has_cors_header()
print("All CORS/error-middleware tests passed.")
