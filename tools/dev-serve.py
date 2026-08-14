#!/usr/bin/env python3
"""Tiny static dev server that disables caching.

Same as `python3 -m http.server`, but sends `Cache-Control: no-store` on every
response so edits to the JS modules / GLBs show up on a plain reload instead of
being served stale from the browser's HTTP cache.

  python3 dev-serve.py [port] [directory]

Defaults: port 8123, directory = this file's project root (../).
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    handler = partial(NoCacheHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"no-cache dev server on http://127.0.0.1:{PORT}  (root: {ROOT})")
        httpd.serve_forever()
