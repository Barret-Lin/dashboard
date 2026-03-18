const citationRegex = /(?:\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\d{4}-\d{2}-\d{2}\s+(?!\d{2}:\d{2})[^\s。，！\]\)\(;:：；\.,]+)/g;
const text = '「共偵獲共機36架次」 2026-03-18 ETtoday新聞雲，其中24架次...';
let match;
while ((match = citationRegex.exec(text)) !== null) {
  console.log('Match:', match[0]);
}
