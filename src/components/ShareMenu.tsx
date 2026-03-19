import React, { useState, useRef, useEffect } from 'react';
import { Share2, Printer, FileText, FileCode, FileType, Check, Download } from 'lucide-react';

interface IntelligenceData {
  text: string;
  sources: Array<{
    title: string;
    uri: string;
  }>;
}

interface ShareMenuProps {
  data: IntelligenceData;
  categoryName: string;
}

export function ShareMenu({ data, categoryName }: ShareMenuProps) {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const convertMarkdownToHtml = (md: string) => {
    let html = md
      // Headers
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Lists
      .replace(/^\s*-\s+(.*)/gim, '<li>$1</li>')
      // Paragraphs (simple)
      .split('\n\n').map(p => {
        if (p.startsWith('<h') || p.startsWith('<li>')) return p;
        return `<p>${p}</p>`;
      }).join('\n');

    // Wrap lists
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    return html;
  };

  const handleCopy = async (type: 'text' | 'html' | 'markdown') => {
    try {
      let contentToCopy = '';
      let htmlContent = '';

      const title = `${categoryName} - 台海開源情報儀表板 (OSINT)`;
      const dateStr = new Date().toLocaleString('zh-TW');

      if (type === 'markdown') {
        contentToCopy = `# ${title}\n\n*更新時間: ${dateStr}*\n\n${data.text}\n\n## 來源\n${data.sources.map((s, i) => `${i + 1}. [${s.title}](${s.uri})`).join('\n')}`;
      } else if (type === 'text') {
        // Strip markdown for plain text
        const plainText = data.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*`]/g, '');
        contentToCopy = `${title}\n更新時間: ${dateStr}\n\n${plainText}\n\n來源:\n${data.sources.map((s, i) => `${i + 1}. ${s.title} (${s.uri})`).join('\n')}`;
      } else if (type === 'html') {
        const htmlText = convertMarkdownToHtml(data.text);
        
        htmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #000;">
            <h1 style="color: #111; border-bottom: 2px solid #eee; padding-bottom: 0.5rem;">${title}</h1>
            <p style="color: #666; font-style: italic;">更新時間: ${dateStr}</p>
            <div>${htmlText}</div>
            <h2 style="color: #222; margin-top: 2rem;">來源</h2>
            <ol style="padding-left: 1.5rem;">
              ${data.sources.map(s => `<li style="margin-bottom: 0.5rem;"><a href="${s.uri}" style="color: #0066cc; text-decoration: none;">${s.title}</a></li>`).join('')}
            </ol>
          </div>
        `;
      }

      if (type === 'html') {
        const blobHtml = new Blob([htmlContent], { type: 'text/html' });
        const blobText = new Blob([htmlContent.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
        const clipboardItem = new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText });
        await navigator.clipboard.write([clipboardItem]);
      } else {
        await navigator.clipboard.writeText(contentToCopy);
      }

      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
      setIsExportOpen(false);
    } catch (err) {
      console.error('Failed to copy: ', err);
      alert('複製失敗，請確認您的瀏覽器是否支援剪貼簿功能。');
    }
  };

  const handlePrint = () => {
    setIsExportOpen(false);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('無法開啟列印視窗，請確認是否被瀏覽器阻擋。');
      return;
    }

    const title = `${categoryName} - 台海開源情報儀表板 (OSINT)`;
    const dateStr = new Date().toLocaleString('zh-TW');
    const htmlText = convertMarkdownToHtml(data.text);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 2rem; }
          h1 { color: #111; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
          h2 { color: #222; margin-top: 2rem; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .meta { color: #666; font-size: 0.9rem; font-style: italic; }
          ul, ol { padding-left: 1.5rem; }
          li { margin-bottom: 0.5rem; }
          @media print {
            body { padding: 0; max-width: none; }
            a { text-decoration: none; color: #000; }
          }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <p class="meta">更新時間: ${dateStr}</p>
        <div>${htmlText}</div>
        <h2>來源</h2>
        <ol>
          ${data.sources.map(s => `<li><a href="${s.uri}">${s.title}</a></li>`).join('')}
        </ol>
        <script>
          window.onload = () => { 
            setTimeout(() => {
              window.print(); 
              window.close(); 
            }, 500);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleShare = async () => {
    const title = `${categoryName} - 台海開源情報儀表板 (OSINT)`;
    const dateStr = new Date().toLocaleString('zh-TW');
    const plainText = data.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*`]/g, '');
    const textToShare = `${title}\n更新時間: ${dateStr}\n\n${plainText}\n\n來源:\n${data.sources.map((s, i) => `${i + 1}. ${s.title} (${s.uri})`).join('\n')}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: textToShare,
          url: window.location.href,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
          handleCopy('text');
          alert('原生分享失敗，已將內容複製到剪貼簿。');
        }
      }
    } else {
      handleCopy('text');
      alert('您的瀏覽器不支援原生分享功能，已將內容複製到剪貼簿。');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleShare}
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors text-sm font-mono"
        title="分享"
      >
        <Share2 className="w-4 h-4" />
        <span className="hidden sm:inline">分享</span>
      </button>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsExportOpen(!isExportOpen)}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors text-sm font-mono"
          title="匯出"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">匯出</span>
        </button>

        {isExportOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50 overflow-hidden">
            <div className="p-1">
              <button
                onClick={() => handleCopy('text')}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded transition-colors text-left"
              >
                {copiedType === 'text' ? <Check className="w-4 h-4 text-green-500" /> : <FileText className="w-4 h-4" />}
                純文字
              </button>
              <button
                onClick={() => handleCopy('html')}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded transition-colors text-left"
              >
                {copiedType === 'html' ? <Check className="w-4 h-4 text-green-500" /> : <FileType className="w-4 h-4" />}
                Google Docs 格式
              </button>
              <button
                onClick={() => handleCopy('markdown')}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded transition-colors text-left"
              >
                {copiedType === 'markdown' ? <Check className="w-4 h-4 text-green-500" /> : <FileCode className="w-4 h-4" />}
                Markdown
              </button>
              <div className="h-px bg-zinc-800 my-1"></div>
              <button
                onClick={handlePrint}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 rounded transition-colors text-left"
              >
                <Printer className="w-4 h-4" />
                列印 / 存為 PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
