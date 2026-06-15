#!/usr/bin/env python
"""Format document using win32com - preserves all images, TOC, and content."""
import sys, time, re
sys.stdout.reconfigure(encoding='utf-8')
import pythoncom, win32com.client

pythoncom.CoInitialize()
word = win32com.client.DispatchEx('Word.Application')
word.Visible = False
time.sleep(2)

SRC = r'C:\Users\lb\Documents\xwechat_files\wxid_kntl8qm95eag22_6034\msg\file\2026-06\岗位实习总结(1).docx'
DST = r'C:\Users\lb\Desktop\岗位实习总结_排版.docx'
import os
for f in [DST, DST.replace('.docx','_v1.docx'), DST.replace('.docx','_v2.docx')]:
    try: os.remove(f)
    except: pass

doc = word.Documents.Open(SRC)
time.sleep(1)
print(f'Document opened: {doc.Paragraphs.Count} paragraphs, {doc.Sections.Count} sections')

# ============================================================
# 1. PAGE SETUP: A4, margins T35/B32/L28/R26 for ALL sections
# ============================================================
for i in range(1, doc.Sections.Count + 1):
    sec = doc.Sections(i)
    ps = sec.PageSetup
    ps.PaperSize = 9  # wdPaperA4
    ps.TopMargin = word.CentimetersToPoints(3.5)
    ps.BottomMargin = word.CentimetersToPoints(3.2)
    ps.LeftMargin = word.CentimetersToPoints(2.8)
    ps.RightMargin = word.CentimetersToPoints(2.6)
print('1. Page setup done (A4, T35/B32/L28/R26mm)')

# ============================================================
# 2. PAGE NUMBERS: section 3 (body) only, 仿宋14pt centered, start=1
# ============================================================
body_sec = doc.Sections(3)  # Section 3 = body
# Different first page = false for footer consistency
body_sec.PageSetup.DifferentFirstPageHeaderFooter = False

# Clear existing footer
footer = body_sec.Footers(1)  # wdHeaderFooterPrimary
footer.LinkToPrevious = False
footer.Range.Delete()

# Set footer font and alignment
footer.Range.Font.Name = '仿宋_GB2312'
footer.Range.Font.Size = 14
footer.Range.ParagraphFormat.Alignment = 1  # wdAlignParagraphCenter

# Add PAGE field - the proper way without SeekView
footer.Range.Fields.Add(footer.Range, -1, 'PAGE  ', False)

# Set page number to restart at 1
body_sec.Footers(1).PageNumbers.RestartNumberingAtSection = True
body_sec.Footers(1).PageNumbers.StartingNumber = 1

print('2. Page numbers added to body section (仿宋14pt, centered, start=1)')

# ============================================================
# 3. FORMAT COVER PAGE (Section 1, paras 1-4)
# ============================================================
# Para 1: JIANGXI... - keep as is (has image)
# Para 2: 机械工程学院岗位实习报告
# Para 4: 日期
for i in [2]:
    p = doc.Paragraphs(i)
    p.Range.Font.Name = '黑体'
    p.Range.Font.Size = 24
    p.Range.Font.Bold = True
    p.Alignment = 1  # center
    p.LineSpacingRule = 3  # wdLineSpaceExactly
    p.LineSpacing = 26

for i in [4]:
    p = doc.Paragraphs(i)
    p.Range.Font.Name = '仿宋_GB2312'
    p.Range.Font.Size = 14
    p.Range.Font.Bold = False
    p.Alignment = 1
    p.LineSpacingRule = 3
    p.LineSpacing = 26

print('3. Cover formatted')

# ============================================================
# 4. FORMAT TOC (Section 2, paras 5-22) - DON'T touch content, just page layout
# ============================================================
# TOC title (para 6 = 目录, but actually check - earlier dump shows para 5 is "目录")
# Let me check the actual TOC structure
# Para 6 was empty in the earlier dump
# Paras 7-22 are TOC entries
# Actually with the win32com paragraph count (343 vs python-docx 306), indices may differ slightly

# Get toc title (search for "目  录" or "目录")
for i in range(1, 12):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()
    if '目' in t[:5] and '录' in t[:5]:
        p.Range.Font.Name = '黑体'
        p.Range.Font.Size = 22  # 二号
        p.Range.Font.Bold = True
        p.Alignment = 1
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        print(f'  TOC title: para {i}')
        # Format subsequent TOC entries
        for j in range(i+1, min(i+30, doc.Paragraphs.Count+1)):
            tp = doc.Paragraphs(j)
            tt = tp.Range.Text.strip()
            if not tt:
                continue
            # Check if this looks like a TOC entry (has dots or is short heading text)
            if len(tt) < 60 and ('..' in tt or re.match(r'^[一二三四五六七八九十]', tt)
                                  or tt in ['综述','主体','总结','实习目标','实习要求','实习单位简介','实习单位介绍',
                                           '企业文化','主要产品','实习岗位介绍','岗位概念','岗位职责','实习内容',
                                           '入职报道','岗前培训','实习过程','就业前景分析','实习心得','实习总结']):
                tp.Range.Font.Name = '仿宋_GB2312'
                tp.Range.Font.Size = 14
                tp.Range.Font.Bold = False
                tp.LineSpacingRule = 3
                tp.LineSpacing = 26
            else:
                # Not a TOC entry - TOC section ends
                break
        break

# Also handle the TOC entries with tab stops - find items with dot leaders
for i in range(1, doc.Paragraphs.Count + 1):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()
    # If paragraph has tab stops with dot leaders, it's a TOC entry
    if p.TabStops.Count > 0 and len(t) < 80 and ('..' in t or any(c in t for c in '0123456789')):
        # Keep as-is - TOC is a Word field, don't modify
        pass

print('4. TOC kept as-is (TOC fields preserved)')

# ============================================================
# 5. FORMAT BODY (Section 3, from "综述" onwards)
# ============================================================
# Find body start (first occurrence of "综述" after TOC section)
body_start = 23  # approximate
for i in range(20, min(50, doc.Paragraphs.Count + 1)):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()
    if t == '综述' or t.startswith('综述'):
        body_start = i
        break

print(f'5. Body starts at paragraph {body_start}')

# Chapter headings (centered, 黑体 22pt bold)
chapter_titles = ['综述', '主体', '总结', '实习目标', '实习要求', '实习单位简介',
                  '实习单位介绍', '企业文化', '主要产品', '实习岗位介绍', '岗位概念',
                  '岗位职责', '实习内容', '入职报道', '岗前培训', '实习过程',
                  '就业前景分析', '实习心得', '实习总结']

# Sub headings (4号黑体 bold, left-aligned)
# Pattern: (一), (二), ..., 一、, 二、, ... and numbered items
sub_pattern = re.compile(r'^[一二三四五六七]、|^（[一二三四五六七]）|^[123]\. |^一\)')

count = {'chapter': 0, 'sub': 0, 'body': 0, 'img': 0, 'skip': 0}

for i in range(body_start, doc.Paragraphs.Count + 1):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()

    # Skip empty paragraphs
    if not t:
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        count['skip'] += 1
        continue

    # Check if paragraph has an inline image
    has_img = False
    try:
        if p.Range.InlineShapes.Count > 0:
            for s in range(1, p.Range.InlineShapes.Count + 1):
                if p.Range.InlineShapes(s).Type == 3:  # wdInlineShapePicture
                    has_img = True
                    break
    except:
        pass

    if has_img:
        # Center images, don't change size
        p.Alignment = 1  # center
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        count['img'] += 1
        continue

    # Chapter heading?
    if t in chapter_titles:
        p.Range.Font.Name = '黑体'
        p.Range.Font.Size = 22
        p.Range.Font.Bold = True
        p.Alignment = 1  # center
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
        count['chapter'] += 1
        continue

    # Sub heading?
    if sub_pattern.match(t) or t in ['基本信息', '培训时间', '培训目的', '培训内容', '培训要求']:
        p.Range.Font.Name = '黑体'
        p.Range.Font.Size = 14
        p.Range.Font.Bold = True
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
        count['sub'] += 1
        continue

    # Body text
    p.Range.Font.Name = '仿宋_GB2312'
    p.Range.Font.Size = 14
    p.Range.Font.Bold = False
    p.LineSpacingRule = 3  # wdLineSpaceExactly
    p.LineSpacing = 26
    # First line indent: 2 chars = 28pt (2 * 14pt)
    p.FirstLineIndent = 28  # 2 chars at 14pt font = 28pt
    count['body'] += 1

print(f'   {count}')

# ============================================================
# 6. SAVE
# ============================================================
doc.SaveAs(DST)
doc.Close()
word.Quit()
pythoncom.CoUninitialize()
print(f'\nSaved: {DST}')
print('DONE - all content/images preserved, only formatting changed.')
