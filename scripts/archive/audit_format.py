#!/usr/bin/env python3
"""Format audit: compare generated report against two templates."""
import zipfile, xml.etree.ElementTree as ET, os, re

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
W_f = lambda t: "{%s}%s" % (W, t)

def txt(e):
    return "".join((t.text or "") for t in e.iter(W_f("t")))

def rpr_info(rpr):
    i = {}
    for c in rpr:
        ln = c.tag.split("}")[-1]
        if ln == "sz": i["sz"] = int(c.get(W_f("val"),0))
        elif ln == "szCs": i["szCs"] = int(c.get(W_f("val"),0))
        elif ln in ("b","bCs"): i["bold"] = True
        elif ln == "i": i["italic"] = True
        elif ln == "rFonts":
            i["font"] = c.get(W_f("ascii")) or c.get(W_f("hAnsi")) or c.get(W_f("eastAsia"))
        elif ln == "color": i["color"] = c.get(W_f("val"))
        elif ln == "u": i["underline"] = c.get(W_f("val"))
    if "sz" not in i and "szCs" in i: i["sz"] = i["szCs"]
    return i

def parse_p(p):
    pi = {"runs":[]}
    pPr = p.find(W_f("pPr"))
    if pPr is not None:
        for c in pPr:
            ln = c.tag.split("}")[-1]
            if ln == "jc": pi["alignment"] = c.get(W_f("val"))
            elif ln == "spacing":
                for a in ("before","after","line"):
                    v = c.get(W_f(a))
                    if v: pi[a] = int(v)
                lr = c.get(W_f("lineRule"))
                if lr: pi["lineRule"] = lr
            elif ln == "ind":
                fl = c.get(W_f("firstLine"))
                if fl: pi["firstLine"] = int(fl)
                ll = c.get(W_f("left"))
                if ll: pi["left"] = int(ll)
            elif ln == "pageBreakBefore": pi["pageBreakBefore"] = True
            elif ln == "outlineLvl": pi["outlineLvl"] = int(c.get(W_f("val")))
    for r in p.findall(W_f("r")):
        ri = {}
        rPr = r.find(W_f("rPr"))
        if rPr is not None: ri = rpr_info(rPr)
        t = r.find(W_f("t"))
        dr = r.find(W_f("drawing"))
        if t is not None and t.text: ri["text"] = t.text
        elif dr is not None: ri["text"] = "<DRAWING>"
        else: ri["text"] = ""
        pi["runs"].append(ri)
    pi["text"] = "".join(r.get("text","") for r in pi["runs"])
    return pi

def parse_tc(tc):
    i = {"paragraphs":[]}
    tcPr = tc.find(W_f("tcPr"))
    if tcPr is not None:
        for tw in tcPr.findall(W_f("tcW")):
            i["width"] = int(tw.get(W_f("w"),0))
            i["widthType"] = tw.get(W_f("type"))
        gs = tcPr.find(W_f("gridSpan"))
        if gs is not None: i["gridSpan"] = int(gs.get(W_f("val")))
        va = tcPr.find(W_f("vAlign"))
        if va is not None: i["vAlign"] = va.get(W_f("val"))
        borders = tcPr.find(W_f("tcBorders"))
        if borders is not None:
            bdict = {}
            for bn in ("top","left","bottom","right"):
                b = borders.find(W_f(bn))
                if b is not None:
                    bdict[bn] = {"val":b.get(W_f("val")),"sz":b.get(W_f("sz")),"color":b.get(W_f("color"))}
            if bdict: i["borders"] = bdict
        mar = tcPr.find(W_f("tcMar"))
        if mar is not None:
            mdict = {}
            for mn in ("top","left","bottom","right"):
                m = mar.find(W_f(mn))
                if m is not None: mdict[mn] = {"w":m.get(W_f("w")),"type":m.get(W_f("type"))}
            if mdict: i["cellMargins"] = mdict
        sh = tcPr.find(W_f("shd"))
        if sh is not None: i["shading"] = sh.get(W_f("fill"))
    for p in tc.findall(W_f("p")): i["paragraphs"].append(parse_p(p))
    i["text"] = " | ".join(p["text"] for p in i["paragraphs"] if p["text"])
    return i

def parse_tbl(tbl):
    i = {}
    tblPr = tbl.find(W_f("tblPr"))
    if tblPr is not None:
        tw = tblPr.find(W_f("tblW"))
        if tw is not None: i["tableWidth"] = {"w":tw.get(W_f("w")),"type":tw.get(W_f("type"))}
        borders = tblPr.find(W_f("tblBorders"))
        if borders is not None:
            bdict = {}
            for bn in ("top","left","bottom","right","insideH","insideV"):
                b = borders.find(W_f(bn))
                if b is not None:
                    bdict[bn] = {"val":b.get(W_f("val")),"sz":b.get(W_f("sz")),"color":b.get(W_f("color"))}
            if bdict: i["tableBorders"] = bdict
    grid = tbl.find(W_f("tblGrid"))
    if grid is not None: i["gridCol"] = [int(gc.get(W_f("w"),0)) for gc in grid.findall(W_f("gridCol"))]
    i["rows"] = []
    for tr in tbl.findall(W_f("tr")):
        row = {"cells":[]}
        trPr = tr.find(W_f("trPr"))
        if trPr is not None:
            trh = trPr.find(W_f("trHeight"))
            if trh is not None: row["height"] = trh.get(W_f("val"))
        for tc in tr.findall(W_f("tc")): row["cells"].append(parse_tc(tc))
        i["rows"].append(row)
    return i

def parse_sect(sp):
    i = {}
    pgMar = sp.find(W_f("pgMar"))
    if pgMar is not None:
        i["margins"] = {}
        for m in ("top","bottom","left","right","gutter","footer"):
            v = pgMar.get(W_f(m))
            if v: i["margins"][m] = int(v)
    return i

def load_file(fp):
    with zipfile.ZipFile(fp) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    body = root.find(W_f("body"))
    if body is None: return []
    elems = []
    for e in body:
        ln = e.tag.split("}")[-1]
        if ln == "p": elems.append(("p", parse_p(e)))
        elif ln == "tbl": elems.append(("tbl", parse_tbl(e)))
        elif ln == "sectPr": elems.append(("sectPr", parse_sect(e)))
    return elems

def load_footers(fp):
    r = {}
    try:
        with zipfile.ZipFile(fp) as z:
            for nm in z.namelist():
                if "footer" in nm.lower() and nm.endswith(".xml"):
                    rt = ET.fromstring(z.read(nm))
                    ps = [parse_p(p) for p in rt.findall(W_f("p"))]
                    r[nm] = ps
    except Exception as e: r["error"] = str(e)
    return r

# ============= LOAD =============
FILES = {
    "format_req":    "D:/作业/实训报告格式要求.docx",
    "body_template": "D:/作业/正文模版.docx",
    "generated":     "D:/作业/实训报告_VG8AL.docx",
}

print("=" * 80)
print("LOADING")
print("=" * 80)
data = {}
for k, fp in FILES.items():
    data[k] = load_file(fp)
    pc = sum(1 for e in data[k] if e[0]=="p")
    tc = sum(1 for e in data[k] if e[0]=="tbl")
    sc = sum(1 for e in data[k] if e[0]=="sectPr")
    print(f"{k}: {len(data[k])} elems ({pc}p, {tc}tbl, {sc}sect)")

# ============= A. PAGE-LEVEL =============
print("\n" + "=" * 80)
print("A. PAGE-LEVEL")
print("=" * 80)
for k in FILES:
    for e in data[k]:
        if e[0] == "sectPr":
            print(f"{k}: {e[1]}")

print("\n--- FOOTERS ---")
for k in ("body_template","generated"):
    print(f"\n{k}:")
    ft = load_footers(FILES[k])
    for fn, ps in ft.items():
        print(f"  {fn}:")
        for pi, p in enumerate(ps):
            print(f"    P{pi}: align={p.get('alignment')} text='{p['text']}'")
            for r in p["runs"]:
                print(f"      run: sz={r.get('sz')} font={r.get('font')} bold={r.get('bold')} text='{r.get('text','')[:30]}'")

# ============= B. COVER PAGE =============
print("\n" + "=" * 80)
print("B. COVER PAGE")
print("=" * 80)
for k in FILES:
    cover = []
    for e in data[k]:
        if e[0] == "p": cover.append(e[1])
        elif e[0] == "sectPr": break
    print(f"\n{k} cover ({len(cover)}p):")
    for i, p in enumerate(cover):
        tx = p["text"][:70]
        print(f"  P{i}: '{tx}'")
        print(f"       align={p.get('alignment')} before={p.get('before')} after={p.get('after')} line={p.get('line')} lineRule={p.get('lineRule')}")
        for r in p["runs"]:
            print(f"       run: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')} text='{r.get('text','')[:40]}'")

# ============= C. MAIN TITLE =============
print("\n" + "=" * 80)
print("C. MAIN TITLE")
print("=" * 80)
for k in FILES:
    for e in data[k]:
        if e[0] == "p" and "牙膏" in e[1]["text"] and "多项" in e[1]["text"]:
            p = e[1]
            print(f"\n{k}: '{p['text']}'")
            print(f"  align={p.get('alignment')} before={p.get('before')} after={p.get('after')} line={p.get('line')} lineRule={p.get('lineRule')}")
            for r in p["runs"]:
                print(f"  run: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")

# ============= D. SECTION HEADINGS =============
print("\n" + "=" * 80)
print("D. SECTION HEADINGS")
print("=" * 80)
for k in FILES:
    print(f"\n{k}:")
    for e in data[k]:
        if e[0] != "p": continue
        t = e[1]["text"]
        h1 = re.match(r"^[123]\s{2}", t)
        h2 = re.match(r"^[123]\.\d\s{2}", t)
        h3 = re.match(r"^[123]\.\d+\.\d+\s", t)
        if h1 or h2 or h3:
            lv = "h1" if h1 else ("h2" if h2 else "h3")
            p = e[1]
            print(f"  [{lv}] '{t[:60]}'")
            print(f"       before={p.get('before')} after={p.get('after')} line={p.get('line')} lineRule={p.get('lineRule')}")
            for r in p["runs"][:1]:
                print(f"       run0: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")

# ============= E. BODY TEXT (sample) =============
print("\n" + "=" * 80)
print("E. BODY TEXT")
print("=" * 80)
for k in FILES:
    print(f"\n{k}:")
    c = 0
    for e in data[k]:
        if e[0] != "p": continue
        t = e[1]["text"]
        skip = (r"^[123]\s{2}", r"^[123]\.\d", r"^[表图]\d", r"^（20", "牙膏中多项指标")
        if len(t) > 30 and not any(re.match(sp, t) if sp.startswith("^") else sp in t for sp in skip):
            if "学院" in t[:5] or "专业" in t[:5] or "班级" in t[:5] or "姓名" in t[:5]: continue
            if "______年" in t: continue
            p = e[1]
            if c < 3:
                print(f"  '{t[:80]}...'")
                print(f"       before={p.get('before')} after={p.get('after')} line={p.get('line')} lineRule={p.get('lineRule')} firstLine={p.get('firstLine')}")
                for r in p["runs"][:1]:
                    print(f"       run0: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")
                c += 1

# ============= F. TABLE FORMATTING (first 3 tables) =============
print("\n" + "=" * 80)
print("F. TABLE FORMATTING (first 3)")
print("=" * 80)
for k in FILES:
    tcount = 0
    for e in data[k]:
        if e[0] != "tbl": continue
        if tcount >= 3: break
        tcount += 1
        t = e[1]
        print(f"\n{k} tbl#{tcount}:")
        print(f"  tableWidth={t.get('tableWidth')}")
        print(f"  tableBorders={t.get('tableBorders')}")
        print(f"  gridCol={t.get('gridCol')}")
        for ri, row in enumerate(t["rows"][:3]):
            print(f"  Row{ri}: height={row.get('height')}")
            for ci, cell in enumerate(row["cells"][:5]):
                print(f"    Cell({ri},{ci}): w={cell.get('width')} wType={cell.get('widthType')} gs={cell.get('gridSpan')} vAlign={cell.get('vAlign')}")
                print(f"      borders={cell.get('borders')}")
                print(f"      margins={cell.get('cellMargins')} shading={cell.get('shading')}")
                for pi, cp in enumerate(cell["paragraphs"]):
                    if pi < 2:
                        print(f"      P{pi}: align={cp.get('alignment')} before={cp.get('before')} after={cp.get('after')} line={cp.get('line')} firstLine={cp.get('firstLine')}")
                        print(f"           text='{cp['text'][:50]}'")
                        for r in cp["runs"][:1]:
                            print(f"           run0: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")

# ============= G. TABLE/FIGURE CAPTIONS =============
print("\n" + "=" * 80)
print("G. CAPTIONS")
print("=" * 80)
for k in FILES:
    print(f"\n{k}:")
    for e in data[k]:
        if e[0] != "p": continue
        t = e[1]["text"]
        if re.match(r"^[表图]\d", t):
            p = e[1]
            print(f"  '{t[:60]}'")
            print(f"       align={p.get('alignment')} before={p.get('before')} after={p.get('after')} line={p.get('line')} lineRule={p.get('lineRule')}")
            for r in p["runs"][:1]:
                print(f"       run0: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")

# ============= H. CHART IMAGES =============
print("\n" + "=" * 80)
print("H. CHART IMAGES")
print("=" * 80)
for k in FILES:
    ic = 0
    for e in data[k]:
        if e[0] != "p": continue
        if any("DRAWING" in r.get("text","") for r in e[1]["runs"]):
            ic += 1
            p = e[1]
            print(f"  {k} img#{ic}: before={p.get('before')} after={p.get('after')} align={p.get('alignment')}")

# ============= I. DETECTION REPORT TABLE =============
print("\n" + "=" * 80)
print("I. DETECTION REPORT TABLE (Table 10)")
print("=" * 80)
for k in FILES:
    for e in data[k]:
        if e[0] != "tbl": continue
        t = e[1]
        at = "".join(c["text"] for row in t["rows"] for c in row["cells"])
        if "产品名称" in at and "检测结论" in at:
            print(f"\n{k}:")
            print(f"  tableWidth={t.get('tableWidth')}")
            print(f"  tableBorders={t.get('tableBorders')}")
            print(f"  gridCol={t.get('gridCol')}")
            for ri, row in enumerate(t["rows"]):
                print(f"  Row{ri}:")
                for ci, cell in enumerate(row["cells"]):
                    print(f"    Cell({ri},{ci}): w={cell.get('width')} wType={cell.get('widthType')} gs={cell.get('gridSpan')} vAlign={cell.get('vAlign')}")
                    print(f"      borders={cell.get('borders')}")
                    print(f"      margins={cell.get('cellMargins')}")
                    for pi, cp in enumerate(cell["paragraphs"]):
                        if pi < 5:
                            print(f"      P{pi}: align={cp.get('alignment')} before={cp.get('before')} after={cp.get('after')} line={cp.get('line')} firstLine={cp.get('firstLine')}")
                            print(f"           text='{cp['text'][:80]}'")
                            for r in cp["runs"][:1]:
                                print(f"           run0: sz={r.get('sz')} bold={r.get('bold')} font={r.get('font')}")

print("\n" + "=" * 80)
print("DONE")
print("=" * 80)
