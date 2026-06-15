#!/usr/bin/env python
"""Complete formatting via WPS COM - one pass on a FRESH copy of the original."""
import sys, time, re, os
sys.stdout.reconfigure(encoding='utf-8')
import pythoncom, win32com.client

pythoncom.CoInitialize()
word = win32com.client.DispatchEx('Word.Application')
word.Visible = False
time.sleep(3)
print('WPS started')

SRC = r'C:\Users\lb\Desktop\zzz_fresh.docx'
DST = r'C:\Users\lb\Desktop\岗位实习总结_v999.docx'

doc = word.Documents.Open(SRC)
time.sleep(2)
print(f'Opened: {doc.Paragraphs.Count} paragraphs')

# ============================================================
# 1. PAGE SIZE + MARGINS (all sections)
# ============================================================
for i in range(1, doc.Sections.Count + 1):
    ps = doc.Sections(i).PageSetup
    ps.PageWidth = 595.3
    ps.PageHeight = 841.9
    ps.TopMargin = 99.2
    ps.BottomMargin = 90.7
    ps.LeftMargin = 79.4
    ps.RightMargin = 73.7
print('1. Page: A4, Margins: 35/32/28/26mm')

# ============================================================
# 2. PAGE NUMBER on BODY section (section 3)
# ============================================================
body_sec = doc.Sections(3)
body_sec.PageSetup.DifferentFirstPageHeaderFooter = False
ft = body_sec.Footers(1)  # wdHeaderFooterPrimary
ft.LinkToPrevious = False
ft.Range.Delete()
ft.Range.Text = ''  # clear
ft.Range.Font.Name = '仿宋_GB2312'
ft.Range.Font.Size = 14
ft.Range.ParagraphFormat.Alignment = 1  # center
# Add field via InsertAfter + Fields.Add
ft.Range.Fields.Add(ft.Range, -1, 'PAGE', True)
print('2. Page numbers: 仿宋14pt centered on body section')

# ============================================================
# 3. CLASSIFY AND FORMAT ALL PARAGRAPHS
# ============================================================
# Find TOC boundaries
toc_start = 0
toc_end = 0
body_start = 0
for i in range(1, doc.Paragraphs.Count + 1):
    t = doc.Paragraphs(i).Range.Text.strip()
    if '目' in t and '录' in t and len(t) <= 5:
        toc_start = i
    elif toc_start > 0 and toc_end == 0 and (
        t == '综述' and doc.Paragraphs(i-1).Range.Text.strip() == ''
    ):
        # Found first "综述" after TOC (but skip if there's a TOC entry before)
        # Actually check: if we're past TOC and encounter a chapter heading
        pass

# Simpler: find where body content starts
# The original has: cover (section 1, paras ~1-40), TOC (section 2, paras ~41-60), body (section 3, ~61+)
# But wait, actual para count is 343, section breaks at different places

# Let me scan for headings
chapter_titles = ['综述', '主体', '总结', '实习目标', '实习要求', '实习单位简介',
                  '实习单位介绍', '企业文化', '主要产品', '实习岗位介绍', '岗位概念',
                  '岗位职责', '实习内容', '入职报道', '岗前培训', '实习过程',
                  '就业前景分析', '实习心得', '实习总结']

sub_pattern = re.compile(r'^[一二三四五六七]、|^（[一二三四五六七]）|^[123]\. |^一\)')
detail_titles = ['基本信息', '培训时间', '培训目的', '培训内容', '培训要求']

# We need to keep the TOC intact but fix its format
# The rest of the body gets formatted

for i in range(1, doc.Paragraphs.Count + 1):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()

    # Skip empty paragraphs, just set line spacing
    if not t:
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        continue

    # Check for images
    has_img = False
    try:
        for s in range(1, p.Range.InlineShapes.Count + 1):
            if p.Range.InlineShapes(s).Type == 3:
                has_img = True
                break
    except: pass

    if has_img:
        p.Alignment = 1
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        continue

    # Skip cover page content (section 1)
    # Para 1 = school logo/img, Para 2 = school name, etc.
    if i <= 42:  # Cover section ends before TOC
        # Leave as-is for now
        continue

    # === TOC section (paras 43-60) ===
    if 43 <= i <= 61:
        if t == '目录':
            p.Range.Font.Name = '黑体'
            p.Range.Font.Size = 22
            p.Range.Font.Bold = True
            p.Alignment = 1
            p.LineSpacingRule = 3
            p.LineSpacing = 26
            p.FirstLineIndent = 0
        else:
            p.Range.Font.Name = '仿宋_GB2312'
            p.Range.Font.Size = 14
            p.Range.Font.Bold = False
            p.Alignment = 0
            p.LineSpacingRule = 3
            p.LineSpacing = 26
            p.FirstLineIndent = 0
            # Clear existing tab stops and add right-aligned dot leader tab
            p.TabStops.ClearAll()
            # Right margin = 156mm = 442pt from left
            p.TabStops.Add(442, 2, 1)  # right-aligned, dot leader
        continue

    # === BODY (para 62+) ===
    if t in chapter_titles:
        p.Range.Font.Name = '黑体'
        p.Range.Font.Size = 22
        p.Range.Font.Bold = True
        p.Alignment = 1
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
    elif sub_pattern.match(t) or t in detail_titles:
        p.Range.Font.Name = '黑体'
        p.Range.Font.Size = 14
        p.Range.Font.Bold = True
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
    else:
        p.Range.Font.Name = '仿宋_GB2312'
        p.Range.Font.Size = 14
        p.Range.Font.Bold = False
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 28  # 2 chars

print('3. All paragraphs formatted')

# ============================================================
# 4. SAVE
# ============================================================
doc.SaveAs(DST)
doc.Close()
word.Quit()
pythoncom.CoUninitialize()
print(f'\nSaved: {DST}')
print('DONE')
