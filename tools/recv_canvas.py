"""Receive a canvas grab from the page and write it to a file.

Headless Chrome has no GPU and renders the facade shader as mush, so stills are
captured from a real browser canvas instead. This listens for the POST.

    python3 tools/recv_canvas.py out.png

Then in the page console (see HANDOFF.md):

    atx.renderFrame();
    const b = await new Promise(r => atx.renderer.domElement.toBlob(r, 'image/png'));
    await fetch('http://127.0.0.1:8799/save', { method: 'POST', body: b });
"""
import http.server, socketserver, os, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('OUT', 'canvas.png')
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(n)
        open(OUT, 'wb').write(data)
        print(f'wrote {OUT} ({len(data)} bytes)', flush=True)
        self.send_response(200); self._cors()
        self.send_header('Content-Type', 'text/plain'); self.end_headers()
        self.wfile.write(b'ok ' + str(len(data)).encode())
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', 8799), H) as s:
    print(f'listening on 127.0.0.1:8799, will write {OUT}', flush=True)
    s.serve_forever()
