# 医学教材问答 PWA

这是独立的纯前端版本，不依赖原来的 Windows/Python 后端。

## 能做什么

- 在浏览器里上传 PDF 教材
- 用 PDF.js 抽取教材文字
- 用 IndexedDB 在本机浏览器保存教材索引
- 本地关键词检索教材片段
- 前端直接调用 DeepSeek 生成带 `[T1]` 引用的回答
- 点击回答里的引用编号，展开对应教材片段

## 限制

- iOS 不能直接把本地文件夹当作 PWA 安装到主屏幕；PWA 需要通过 HTTPS 打开。
- DeepSeek API Key 会保存在当前浏览器本地，不建议多人共用同一台设备。
- 大 PDF 在 iPhone 上抽取和索引会比较慢，建议优先用 iPad 或先少量导入教材。
- 这个版本不接 PubMed、Europe PMC、Tavily 或国内网页搜索，因为纯前端调用搜索 API 常见 CORS 限制，也会暴露搜索 API Key。

## iOS 使用方式

最实用的方式是把 `ios-pwa` 文件夹发布到免费静态托管：

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

发布后，在 iPhone 或 iPad Safari 打开 HTTPS 地址，点击分享按钮，然后选择“添加到主屏幕”。

## 本地预览

如果只是在电脑上预览，可以在 `ios-pwa` 目录运行一个静态服务：

```powershell
python -m http.server 8899
```

然后打开：

```text
http://127.0.0.1:8899
```

## 使用步骤

1. 打开页面
2. 点“设置”，填写 DeepSeek API Key
3. 点“教材”，上传 PDF
4. 等待索引完成
5. 输入问题并提问

## 和电脑端版本的区别

电脑端版本更完整，包含 Python 后端、SQLite、PubMed/Europe PMC/Tavily 搜索。  
这个 PWA 版本只保留无服务器条件下能稳定工作的核心：本地教材问答。
