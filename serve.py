# 数独 · 本地静态服务器
# 用法：python serve.py [端口]
# 双击「启动数独.cmd」会自动调用本脚本并打开浏览器。
#
# 为什么需要它：OCR（图片识别）要用 Web Worker 和 fetch 读取本地文件，
# 浏览器的同源策略会拒绝 file:// 协议下的这些操作，所以这一项必须走 http。
# 其余功能（出题、提示、技巧教学、统计、导入导出）直接双击 index.html 也能用。

import http.server
import os
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 开发期禁用缓存，改完刷新即可看到
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 静默，避免刷屏
        pass


class Server(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    url = f"http://127.0.0.1:{PORT}/index.html"
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"端口 {PORT} 已被占用，可能已经有一个数独服务在运行。")
        print(f"直接打开：{url}")
        webbrowser.open(url)
        return

    print("数独已启动：" + url)
    print("按 Ctrl+C 停止服务。\n")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
