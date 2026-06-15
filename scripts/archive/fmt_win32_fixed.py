#!/usr/bin/env python
"""Format document using win32com - preserves all images, TOC, and content."""
import sys, time, re
sys.stdout.reconfigure(encoding='utf-8')
import pythoncom, win32com.client

pythoncom.CoInitialize()
word = win32com.client.DispatchEx('Word.Application')
word.Visible = False
time.sleep(2)

SRC = r'C:\Users\lb\Documents\xwechat_files\wxid_kntl8qm95eag22_6034\msg\file\2026-06\宀椾綅瀹炰範鎬荤粨(1).docx'
DST = r'C:\Users\lb\Desktop\宀椾綅瀹炰範鎬荤粨_鎺掔増.docx'
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
# 2. PAGE NUMBERS: section 3 (body) only, 浠垮畫14pt centered, start=1
# ============================================================
body_sec = doc.Sections(3)  # Section 3 = body
# Different first page = false for footer consistency
body_sec.PageSetup.DifferentFirstPageHeaderFooter = False

# Clear existing footer
footer = body_sec.Footers(1)  # wdHeaderFooterPrimary
footer.LinkToPrevious = False
footer.Range.Delete()

# Add page number field
footer.Range.Font.Name = '浠垮畫_GB2312'
footer.Range.Font.Size = 14
footer.Range.ParagraphFormat.Alignment = 1  # wdAlignParagraphCenter

# Insert PAGE field
doc.ActiveWindow.ActivePane.View.SeekView = 4  # wdSeekCurrentPageFooter
word.Selection.Fields.Add(word.Selection.Range, -1, 'PAGE', False)
# Go back to main document
doc.ActiveWindow.ActivePane.View.SeekView = 0  # wdSeekMainDocument

# Set page number start = 1
body_sec.PageSetup.SectionStart = 0  # wdSectionContinuous (don't change)
body_sec.Footers(1).PageNumbers.StartingNumber = 1
# Alternative: set via section footers
try:
    body_sec.Footers(1).PageNumbers.RestartNumberingAtSection = True
    body_sec.Footers(1).PageNumbers.StartingNumber = 1
except:
    pass

# Add pgNumType to section XML using Range
rng = body_sec.Footers(1).Range
rng.Fields.Add(rng, -1, 'PAGE', False)

print('2. Page numbers added to body section (浠垮畫14pt, centered, start=1)')

# ============================================================
# 3. FORMAT COVER PAGE (Section 1, paras 1-4)
# ============================================================
# Para 1: JIANGXI... - keep as is (has image)
# Para 2: 鏈烘宸ョ▼瀛﹂櫌宀椾綅瀹炰範鎶ュ憡
# Para 4: 鏃ユ湡
for i in [2]:
    p = doc.Paragraphs(i)
    p.Range.Font.Name = '榛戜綋'
    p.Range.Font.Size = 24
    p.Range.Font.Bold = True
    p.Alignment = 1  # center
    p.LineSpacingRule = 3  # wdLineSpaceExactly
    p.LineSpacing = 26

for i in [4]:
    p = doc.Paragraphs(i)
    p.Range.Font.Name = '浠垮畫_GB2312'
    p.Range.Font.Size = 14
    p.Range.Font.Bold = False
    p.Alignment = 1
    p.LineSpacingRule = 3
    p.LineSpacing = 26

print('3. Cover formatted')

# ============================================================
# 4. FORMAT TOC (Section 2, paras 5-22) - DON'T touch content, just page layout
# ============================================================
# TOC title (para 6 = 鐩綍, but actually check - earlier dump shows para 5 is "鐩綍")
# Let me check the actual TOC structure
# Para 6 was empty in the earlier dump
# Paras 7-22 are TOC entries
# Actually with the win32com paragraph count (343 vs python-docx 306), indices may differ slightly

# Get toc title (search for "鐩? 褰? or "鐩綍")
for i in range(1, 12):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()
    if '鐩? in t[:5] and '褰? in t[:5]:
        p.Range.Font.Name = '榛戜綋'
        p.Range.Font.Size = 22  # 浜屽彿
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
            if len(tt) < 60 and ('..' in tt or re.match(r'^[涓€浜屼笁鍥涗簲鍏竷鍏節鍗乚', tt)
                                  or tt in ['缁艰堪','涓讳綋','鎬荤粨','瀹炰範鐩爣','瀹炰範瑕佹眰','瀹炰範鍗曚綅绠€浠?,'瀹炰範鍗曚綅浠嬬粛',
                                           '浼佷笟鏂囧寲','涓昏浜у搧','瀹炰範宀椾綅浠嬬粛','宀椾綅姒傚康','宀椾綅鑱岃矗','瀹炰範鍐呭',
                                           '鍏ヨ亴鎶ラ亾','宀楀墠鍩硅','瀹炰範杩囩▼','灏变笟鍓嶆櫙鍒嗘瀽','瀹炰範蹇冨緱','瀹炰範鎬荤粨']):
                tp.Range.Font.Name = '浠垮畫_GB2312'
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
# 5. FORMAT BODY (Section 3, from "缁艰堪" onwards)
# ============================================================
# Find body start (first occurrence of "缁艰堪" after TOC section)
body_start = 23  # approximate
for i in range(20, min(50, doc.Paragraphs.Count + 1)):
    p = doc.Paragraphs(i)
    t = p.Range.Text.strip()
    if t == '缁艰堪' or t.startswith('缁艰堪'):
        body_start = i
        break

print(f'5. Body starts at paragraph {body_start}')

# Chapter headings (centered, 榛戜綋 22pt bold)
chapter_titles = ['缁艰堪', '涓讳綋', '鎬荤粨', '瀹炰範鐩爣', '瀹炰範瑕佹眰', '瀹炰範鍗曚綅绠€浠?,
                  '瀹炰範鍗曚綅浠嬬粛', '浼佷笟鏂囧寲', '涓昏浜у搧', '瀹炰範宀椾綅浠嬬粛', '宀椾綅姒傚康',
                  '宀椾綅鑱岃矗', '瀹炰範鍐呭', '鍏ヨ亴鎶ラ亾', '宀楀墠鍩硅', '瀹炰範杩囩▼',
                  '灏变笟鍓嶆櫙鍒嗘瀽', '瀹炰範蹇冨緱', '瀹炰範鎬荤粨']

# Sub headings (4鍙烽粦浣?bold, left-aligned)
# Pattern: (涓€), (浜?, ..., 涓€銆? 浜屻€? ... and numbered items
sub_pattern = re.compile(r'^[涓€浜屼笁鍥涗簲鍏竷]銆亅^锛圼涓€浜屼笁鍥涗簲鍏竷]锛墊^[123]\. |^涓€\)')

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
        p.Range.Font.Name = '榛戜綋'
        p.Range.Font.Size = 22
        p.Range.Font.Bold = True
        p.Alignment = 1  # center
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
        count['chapter'] += 1
        continue

    # Sub heading?
    if sub_pattern.match(t) or t in ['鍩烘湰淇℃伅', '鍩硅鏃堕棿', '鍩硅鐩殑', '鍩硅鍐呭', '鍩硅瑕佹眰']:
        p.Range.Font.Name = '榛戜綋'
        p.Range.Font.Size = 14
        p.Range.Font.Bold = True
        p.LineSpacingRule = 3
        p.LineSpacing = 26
        p.FirstLineIndent = 0
        count['sub'] += 1
        continue

    # Body text
    p.Range.Font.Name = '浠垮畫_GB2312'
    p.Range.Font.Size = 14
    p.Range.Font.Bold = False
    p.LineSpacingRule = 3  # wdLineSpaceExactly
    p.LineSpacing = 26
    # First line indent: 2 chars = 28pt (2 * 14pt)
    p.FirstLineIndent = word.CentimetersToPoints(0.75)  # ~2 chars
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
