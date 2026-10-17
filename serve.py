#!/usr/bin/env python3
"""Local preview server that disables browser caching.

Python's plain http.server lets the browser reuse cached modules, so after an edit the page can mix new and
old JavaScript files and fail to start. This sends `Cache-Control: no-store` on every response.

Usage (from this directory): python3 serve.py [port]   -> http://127.0.0.1:8765/
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = partial(NoCacheHandler, directory=str(Path(__file__).parent))
    print(f"Serving http://127.0.0.1:{port}/ (no caching)")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
