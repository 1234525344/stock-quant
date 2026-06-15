import docx, sys, copy
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Pt, Cm
from docx.enum.text import WD_LINE_SPACING, WD_ALIGN_PARAGRAPH

sys.stdout.reconfigure(encoding='utf-8')

inpath = r'C:/Users/lb/Documents/xwechat_files/wxid_kntl8qm95eag22_6034/msg/file/2026-06/金贝贝实习报告002.docx'
tmppath = inpath + '.tmp'

doc = docx.Document(inpath)

SONGTI = '宋体'
FZHT = '方正黑体_GBK'
FZKT = '方正楷体_GBK'
XS4 = Pt(12)
S4 = Pt(14)
LINE_28 = Pt(28)

def make_run_font(run, font_name, size, bold=False):
    run.font.name = font_name
    run.font.size = size
    run.bold = bold
    rPr = run._r.find(qn('w:rPr'))
    if rPr is None:
        rPr = OxmlElement('w:rPr')
        run._r.insert(0, rPr)
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.insert(0, rFonts)
    rFonts.set(qn('w:eastAsia'), font_name)
    rFonts.set(qn('w:ascii'), font_name)
    rFonts.set(qn('w:hAnsi'), font_name)

ref_para = doc.paragraphs[219]
ref_element = ref_para._element
insert_after_ref = [ref_element]

def insert_para(text, font_name=SONGTI, size=XS4, bold=False, alignment=None, is_title=False):
    global insert_after_ref
    insert_after = insert_after_ref[0]

    new_p = OxmlElement('w:p')

    pPr = OxmlElement('w:pPr')
    spacing = OxmlElement('w:spacing')
    spacing.set(qn('w:line'), str(int(LINE_28)))
    spacing.set(qn('w:lineRule'), 'exact')
    spacing.set(qn('w:before'), '0')
    spacing.set(qn('w:after'), '0')
    pPr.append(spacing)

    if alignment == 'center':
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), 'center')
        pPr.append(jc)
    elif alignment == 'both':
        jc = OxmlElement('w:jc')
        jc.set(qn('w:val'), 'both')
        pPr.append(jc)

    if not is_title:
        ind = OxmlElement('w:ind')
        ind.set(qn('w:firstLine'), '480')
        pPr.append(ind)

    new_p.append(pPr)

    r = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')
    rFonts = OxmlElement('w:rFonts')
    rFonts.set(qn('w:eastAsia'), font_name)
    rFonts.set(qn('w:ascii'), font_name)
    rFonts.set(qn('w:hAnsi'), font_name)
    rPr.append(rFonts)
    sz = OxmlElement('w:sz')
    sz.set(qn('w:val'), str(int(size / 12700 * 2)))
    rPr.append(sz)
    szCs = OxmlElement('w:szCs')
    szCs.set(qn('w:val'), str(int(size / 12700 * 2)))
    rPr.append(szCs)
    if bold:
        b = OxmlElement('w:b')
        rPr.append(b)
    r.append(rPr)
    t = OxmlElement('w:t')
    t.set(qn('xml:space'), 'preserve')
    t.text = text
    r.append(t)
    new_p.append(r)

    parent = insert_after.getparent()
    idx = list(parent).index(insert_after)
    parent.insert(idx + 1, new_p)
    insert_after_ref[0] = new_p
    return new_p

print('Functions defined. Writing content...')
sys.stdout.flush()
