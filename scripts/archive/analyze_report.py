import sys, re, json, os
sys.stdout.reconfigure(encoding='utf-8')

# ===== READ ORIGINAL CONTENT =====
import docx as dx
src = dx.Document(r'C:/Users/lb/Documents/xwechat_files/wxid_kntl8qm95eag22_6034/msg/file/2026-06/岗位实习总结(1).docx')

# Extract all body text paragraphs (para 23 onwards, skip TOC area)
all_text = {}
for i, p in enumerate(src.paragraphs):
    t = p.text.strip()
    if t and i >= 23:
        all_text[str(i)] = t

# Save content for reuse
with open(r'C:\Users\lb\stock-quant\internship_content.json', 'w', encoding='utf-8') as f:
    json.dump(all_text, f, ensure_ascii=False)

# Print summary of available content
sections_found = []
for k, v in all_text.items():
    if any(v.startswith(w) for w in ['综述','实习目标','一、','二、','三、','（','1.','实习单位','企业','主要','岗位','实习内容','入职','岗前','实习过程','就业','实习心得','实习总结']):
        sections_found.append(f'[{k}] {v[:80]}')
for s in sections_found[:30]:
    print(s)
print(f'Total paragraphs: {len(all_text)}')
