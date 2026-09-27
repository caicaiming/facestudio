// 最小静态服务器：MIME 正确、支持任意子路径，用于本地复刻 GitHub Pages
// 的子路径部署环境。用法：node scripts/static-server.mjs <站点根目录> [端口]
// （python -m http.server 在 Windows 下会把 .js 发成 text/plain，不可用）
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.argv[2]
const PORT = Number(process.argv[3] || 8082)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(ROOT, url)
    // 防目录穿越
    if (!file.startsWith(path.resolve(ROOT))) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html')
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found: ' + url)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, () => console.log('serving ' + ROOT + ' at http://localhost:' + PORT))
