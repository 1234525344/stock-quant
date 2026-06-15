#!/usr/bin/env python
"""Generate professional electrical engineering diagrams v2 for course design report."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
import numpy as np
from matplotlib.patches import (Rectangle, FancyBboxPatch, Circle, Polygon,
                                 Arc, Ellipse, FancyArrowPatch, Wedge)
import sys, os

sys.stdout.reconfigure(encoding='utf-8')
plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False
OUT = r'C:/Users/lb/stock-quant/diagrams_v2'
os.makedirs(OUT, exist_ok=True)
DPI = 180

# ===== SYMBOLS =====
def draw_breaker(ax, xy, w=0.6, h=0.4, label='', facecolor='white'):
    x, y = xy
    rect = FancyBboxPatch((x-w/2, y-h/2), w, h, boxstyle='round,pad=0.05',
                          fill=True, facecolor=facecolor, edgecolor='black', lw=1.2)
    ax.add_patch(rect)
    ax.plot([x, x], [y+h/2, y+h/2+0.15], 'k-', lw=1.5)
    if label:
        ax.text(x, y, label, ha='center', va='center', fontsize=7, fontweight='bold')

def draw_socket_3hole(ax, xy, size=0.5):
    x, y = xy; r = size/2
    circle = Circle((x, y), r, fill=False, edgecolor='black', lw=1.5)
    ax.add_patch(circle)
    ax.plot([x-r*0.7, x+r*0.7], [y, y], 'k-', lw=1)
    ax.plot([x-r*0.3, x+r*0.3], [y+r*0.35, y+r*0.35], 'k-', lw=1)
    ax.plot([x, x], [y+r*0.35, y-r*0.5], 'k-', lw=1)

def draw_socket_5hole(ax, xy, size=0.5):
    x, y = xy; r = size/2
    circle = Circle((x, y), r, fill=False, edgecolor='black', lw=1.5)
    ax.add_patch(circle)
    ax.plot([x-r*0.7, x+r*0.7], [y, y], 'k-', lw=1)
    ax.plot([x-r*0.3, x+r*0.3], [y-r*0.35, y-r*0.35], 'k-', lw=1)
    ax.plot([x-r*0.3, x+r*0.3], [y+r*0.35, y+r*0.35], 'k-', lw=1)
    ax.plot([x, x], [y-r*0.35, y+r*0.35], 'k-', lw=1)

def draw_switch_sym(ax, xy, size=0.4):
    x, y = xy; r = size/2
    circle = Circle((x, y), r, fill=True, facecolor='white', edgecolor='black', lw=1.5)
    ax.add_patch(circle)
    ax.plot([x, x+r*0.6], [y, y+r*0.3], 'k-', lw=1.5)

def draw_light_sym(ax, xy, size=0.5):
    x, y = xy; r = size/2
    circle = Circle((x, y), r, fill=False, edgecolor='black', lw=1.5, zorder=5)
    ax.add_patch(circle)
    ax.plot([x, x], [y, y-r*1.2], 'k-', lw=1.2, zorder=4)
    ax.plot([x-r*0.6, x+r*0.6], [y-r*0.2, y-r*0.2], 'k-', lw=1.2, zorder=4)

def draw_kwh_meter(ax, xy, w=1.0, h=0.6):
    x, y = xy
    rect = FancyBboxPatch((x-w/2, y-h/2), w, h, boxstyle='round,pad=0.05',
                          fill=True, facecolor='lightyellow', edgecolor='black', lw=1.5)
    ax.add_patch(rect)
    ax.text(x, y, 'kWh', ha='center', va='center', fontsize=9, fontweight='bold')

def draw_dim_line(ax, x1, y, x2, text_y, text, side='top'):
    ax.plot([x1, x2], [y, y], 'k-', lw=1)
    ax.plot([x1, x1], [y, y+0.2], 'k-', lw=0.8)
    ax.plot([x2, x2], [y, y+0.2], 'k-', lw=0.8)
    # Arrows
    ax.plot([x1, x1+0.12], [y, y+0.1], 'k-', lw=0.5)
    ax.plot([x1, x1-0.12], [y, y+0.1], 'k-', lw=0.5)
    ax.plot([x2, x2+0.12], [y, y+0.1], 'k-', lw=0.5)
    ax.plot([x2, x2-0.12], [y, y+0.1], 'k-', lw=0.5)
    ax.text((x1+x2)/2, text_y, text, ha='center', fontsize=8, fontweight='bold')

# ============================================================
# FIG 3-1: Lighting Floor Plan
# ============================================================
fig, ax = plt.subplots(1, 1, figsize=(17, 12))

# Floor plan with wall lines
def wall(x1, y1, x2, y2, lw=2.5):
    ax.plot([x1, x2], [y1, y2], 'k-', lw=lw)

# Outer walls
wall(0, 0, 10.5, 0); wall(10.5, 0, 10.5, 7.2); wall(10.5, 7.2, 0, 7.2)
wall(0, 7.2, 0, 4.4); wall(0, 4.4, 1.35, 4.4); wall(1.35, 4.4, 1.35, 0); wall(1.35, 0, 0, 0)

# Interior walls
wall(1.85, 4.4, 1.85, 7.2, 2)
wall(3.55, 4.4, 3.55, 7.2, 2)
wall(7.2, 0, 7.2, 4.4, 2)
wall(7.2, 4.4, 7.2, 7.2, 2.5)
wall(3.2, 0, 3.2, 4.4, 2)
wall(0, 4.4, 7.2, 4.4, 2.5)
wall(7.2, 4.4, 10.5, 4.4, 2.5)

# Balcony line
ax.plot([0, 10.5], [1.5, 1.5], 'k-', lw=1, ls='--', dashes=(6,4), color='black')

# Doors (arcs)
dor1 = Arc((3.55, 5.5), 1.2, 1.2, theta1=90, theta2=180, color='black', lw=1.2, ls='--')
ax.add_patch(dor1)
ax.plot([3.55, 3.55], [5.3, 6.6], 'w-', lw=4)  # door opening
dor2 = Arc((7.2, 3.2), 1.3, 1.3, theta1=0, theta2=90, color='black', lw=1.2, ls='--')
ax.add_patch(dor2)
ax.plot([7.2, 7.2], [3.0, 4.2], 'w-', lw=4)

# Room names
labels = [
    (0.7, 5.8, '厨房', '4.1 m2'),
    (2.7, 5.8, '卫生间', '2.6 m2'),
    (5.4, 5.8, '次卧室', '8.5 m2'),
    (8.8, 5.8, '主卧室', '10.6 m2'),
    (1.6, 2.5, '书房', '9.1 m2'),
    (5.8, 2.5, '客    厅', '15.6 m2'),
    (5.2, 0.7, '阳台', '12.9 m2'),
]
for x, y, name, area in labels:
    ax.text(x, y, f'{name}\n{area}', ha='center', va='center', fontsize=9 if '客厅' not in name else 12,
            bbox=dict(boxstyle='round,pad=0.2', facecolor='white', alpha=0.8, edgecolor='none'))

# Dimension lines
draw_dim_line(ax, 0, -0.3, 3.2, -0.6, '3200'); draw_dim_line(ax, 3.2, -0.3, 7.2, -0.6, '4000')
draw_dim_line(ax, 7.2, -0.3, 10.5, -0.6, '3300')
draw_dim_line(ax, 0, 7.5, 1.85, 7.8, '1850'); draw_dim_line(ax, 1.85, 7.5, 3.55, 7.8, '1700')
draw_dim_line(ax, 3.55, 7.5, 7.2, 7.8, '3650'); draw_dim_line(ax, 7.2, 7.5, 10.5, 7.8, '3300')

# Lighting symbols
lights = {
    'ceiling': [(0.9, 6.6,'1'),(2.7,6.6,'11'),(5.4,6.6,'5'),(8.8,6.6,'2'),(1.6,3.2,'7'),(5.8,3.0,'14'),(5.2,0.7,'17'),(8.8,3.2,'16')],
    'desk': [(8.8,5.8,'3'),(5.4,5.8,'6'),(1.6,2.5,'8')],
    'bedside': [(10.2,6.8,'4')],
    'mirror': [(2.2,6.6,'10')],
    'decor': [(4.5,2.5,'12'),(6.5,2.5,'15'),(7.5,2.5,'13')],
}
for x,y,label in lights['ceiling']:
    draw_light_sym(ax, (x,y), 0.5); ax.text(x,y-0.25,label,ha='center',fontsize=6,fontweight='bold')
for x,y,label in lights['desk']:
    ax.plot(x,y,'s',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=5); ax.text(x,y-0.25,label,ha='center',fontsize=6,fontweight='bold')
for x,y,label in lights['bedside']:
    ax.plot(x,y,'s',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=5); ax.text(x,y-0.25,label,ha='center',fontsize=6,fontweight='bold')
for x,y,label in lights['mirror']:
    ax.plot(x,y,'s',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=5); ax.text(x,y-0.25,label,ha='center',fontsize=6,fontweight='bold')
for x,y,label in lights['decor']:
    ax.plot(x,y,'^',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=5); ax.text(x,y-0.25,label,ha='center',fontsize=6,fontweight='bold')

# Legend
lx, ly = 0.5, -1.5
draw_light_sym(ax,(lx,ly),0.4); ax.text(lx+0.4,ly,'普通照明(吸顶灯)',fontsize=7,va='center')
lx+=3.5; ax.plot(lx,ly,'s',color='white',markersize=6,markeredgecolor='black',markeredgewidth=1.5); ax.text(lx+0.4,ly,'点照明(台灯/镜前灯)',fontsize=7,va='center')
lx+=4.2; ax.plot(lx,ly,'^',color='white',markersize=6,markeredgecolor='black',markeredgewidth=1.5); ax.text(lx+0.4,ly,'装饰照明(筒灯)',fontsize=7,va='center')

ax.set_xlim(-1.5,12); ax.set_ylim(-2.5,9); ax.set_aspect('equal'); ax.axis('off')
ax.set_title('图3-1  照明分布图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图3-1_照明分布图.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('1/8 Fig 3-1 done')

# ============================================================
# FIG 4-1: Power Distribution One-Line Diagram
# ============================================================
fig, ax = plt.subplots(1,1,figsize=(15,14))
ax.set_xlim(0,19); ax.set_ylim(0,36); ax.axis('off')
ax.text(9.5,35.5,'图4-1  供配电系统图',ha='center',fontsize=14,fontweight='bold')

y=34
# Incoming
ax.plot([9.5,9.5],[y,y+1.5],'k-',lw=3)
ax.text(9.5,y+1.7,'AC 220V 50Hz 单相电源  BV-16mm2x2+PE',ha='center',fontsize=9,fontweight='bold')
draw_kwh_meter(ax,(9.5,y-1),2.5,0.8)
ax.text(9.5,y-1.7,'DD862-4  20(80)A',ha='center',fontsize=8,color='gray')
draw_breaker(ax,(9.5,y-3.5),w=2.2,h=0.7,facecolor='lightgray')
ax.text(9.5,y-3.15,'总空开 63A/2P 带漏电保护',ha='center',fontsize=9,fontweight='bold')

# Busbar
ybus = y-5.5
ax.plot([2.5,16.5],[ybus,ybus],'k-',lw=4)
ax.text(17,ybus,'母线',fontsize=7,va='center')
ax.text(9.5,ybus+0.4,'TN-S (L+N+PE)',ha='center',fontsize=7,color='gray')

# 12 circuits
circs = [
    ('左','L1',2.5,'主卧空调',2100,'4mm2','DPN 20A/1P'),
    ('左','L2',2.5,'次卧空调',1800,'4mm2','DPN 20A/1P'),
    ('左','L3',2.5,'书房空调',1800,'4mm2','DPN 20A/1P'),
    ('左','L4',2.5,'客厅空调',2400,'4mm2','DPN 25A/1P'),
    ('左','L5',2.5,'电动车充电',350,'1.5mm2','DPN 10A/1P'),
    ('左','L6',2.5,'浴霸(漏保)',1000,'2.5mm2','DPN 10A/1P'),
    ('右','L7',16.5,'吹风机',1000,'2.5mm2','DPN 10A/1P'),
    ('右','L8',16.5,'厨房电磁炉+水壶(漏保)',3500,'4mm2','DPN 20A/1P'),
    ('右','L9',16.5,'微波炉',800,'2.5mm2','DPN 10A/1P'),
    ('右','L10',16.5,'厨房普通+灯(漏保)',1180,'2.5mm2','DPN 10A/1P'),
    ('右','L11',16.5,'卧室+书房照明插座',2500,'2.5mm2','DPN 16A/1P'),
    ('右','L12',16.5,'公共区域+阳台',2000,'2.5mm2','DPN 16A/1P'),
]
for side, name, bx, desc, power, wire, bkr in circs:
    if side == '左': idx = int(name[1]) - 1
    else: idx = int(name[1]) - 7
    cy = ybus - 1.2 - idx * 2.2
    ax.plot([bx,bx],[ybus-0.3,cy+0.4],'k-',lw=1.2)
    draw_breaker(ax,(bx,cy),w=1.6,h=0.45,label=bkr,facecolor='lightblue')
    ax.plot([bx,bx],[cy-0.3,cy-1.3],'k-',lw=1.2)
    ax.text(bx,cy-1.1,f'{name}  {desc}',ha='center',fontsize=8,fontweight='bold')
    ax.text(bx,cy-1.5,f'{power}W | {wire}',ha='center',fontsize=6.5,color='gray')

# N and PE bars
ax.plot([17.8,17.8],[ybus-0.5,ybus-14],'b-',lw=2)
ax.text(18.1,ybus-7,'N',fontsize=9,color='blue',fontweight='bold',ha='center')
ax.plot([18.3,18.3],[ybus-0.5,ybus-14],'g-',lw=2)
ax.text(18.6,ybus-7,'PE',fontsize=9,color='green',fontweight='bold',ha='center')

fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-1_供配电系统图.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('2/8 Fig 4-1 done')

# ============================================================
# FIG 4-2: High-Power Circuit Detail
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(14,9))
ax.set_xlim(0,16);ax.set_ylim(0,14);ax.axis('off')
ax.text(8,13.7,'图4-2  大功率用电器及插座电气回路图',ha='center',fontsize=14,fontweight='bold')

circs2 = [
    ('L1','主卧空调',2100,'4mm2','DPN 20A','#E74C3C',2),
    ('L2','次卧空调',1800,'4mm2','DPN 20A','#E67E22',4),
    ('L3','书房空调',1800,'4mm2','DPN 20A','#F39C12',6),
    ('L4','客厅空调',2400,'4mm2','DPN 25A','#27AE60',8),
    ('L5','电动车充电',350,'1.5mm2','DPN 10A','#3498DB',10),
    ('L8','电磁炉+水壶',3500,'4mm2','DPN 20A漏保','#8E44AD',12),
    ('L9','微波炉',800,'2.5mm2','DPN 10A','#16A085',14),
]
for name,desc,power,wire,bkr,color,bx in circs2:
    ax.plot([bx,bx],[12,11.5],'k-',lw=2)
    draw_breaker(ax,(bx,11),w=1.5,h=0.5,label=bkr,facecolor=color)
    ax.plot([bx,bx],[10.5,9.5],'k-',lw=1.5)
    ax.text(bx+0.4,10.2,wire,fontsize=6.5,color='blue',rotation=45)
    draw_socket_3hole(ax,(bx,9))
    ax.plot([bx,bx],[8.5,7.8],'k-',lw=1.5)
    rect=FancyBboxPatch((bx-1.2,7.3),2.4,0.5,boxstyle='round',fill=True,facecolor=color,edgecolor='black',alpha=0.3)
    ax.add_patch(rect)
    ax.text(bx,7.55,f'{name}',ha='center',fontsize=9,fontweight='bold')
    ax.text(bx,6.8,f'{desc} {power}W',ha='center',fontsize=7.5)
    # Ground
    ax.plot([bx,bx],[6.5,6.0],'g-',lw=1)
    ax.plot([bx-0.5,bx+0.5],[6.0,6.0],'g-',lw=1.5)
    ax.plot([bx-0.3,bx+0.3],[5.7,5.7],'g-',lw=1.5)
    ax.plot([bx-0.1,bx+0.1],[5.4,5.4],'g-',lw=1.5)

ax.text(1.5,4,'接线: L(红)火线 | N(蓝)零线 | PE(黄绿)地线',fontsize=8)
ax.text(1.5,3.5,'空调插座:16A三孔带开关 | 厨房大功率:16A三孔',fontsize=7,color='gray')
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-2_大功率回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('3/8 Fig 4-2 done')

# ============================================================
# FIG 4-3: Bath Circuit
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(10,8))
ax.set_xlim(0,12);ax.set_ylim(0,16);ax.axis('off')
ax.text(6,15.7,'图4-3  卫生间浴霸及吹风机电气回路接线图',ha='center',fontsize=14,fontweight='bold')

# L6
ax.plot([6,6],[14,13.5],'k-',lw=2)
draw_breaker(ax,(6,13),w=2,h=0.6,label='DPN 10A/1P + 漏电保护',facecolor='lightcoral')
ax.text(6,12.5,'L6 浴霸回路  1000W  BV-2.5mm2',ha='center',fontsize=8,fontweight='bold')
ax.plot([6,6],[12.3,11.5],'k-',lw=1.5)
circle=Circle((6,11),0.3,fill=True,facecolor='gray',edgecolor='black',lw=1.5);ax.add_patch(circle)
ax.text(6,11,'JB',ha='center',va='center',fontsize=7,fontweight='bold')
ax.plot([6,3],[10.7,8.5],'k-',lw=1.2)
ax.plot([6,9],[10.7,8.5],'k-',lw=1.2)

rect=FancyBboxPatch((2,6.5),3,2,boxstyle='round',fill=True,facecolor='orange',edgecolor='black',alpha=0.3);ax.add_patch(rect)
ax.text(3.5,8,'浴霸主机',fontsize=10,fontweight='bold')
ax.text(3.5,7.5,'取暖灯 275Wx2',fontsize=7);ax.text(3.5,7.1,'照明灯 60W',fontsize=7);ax.text(3.5,6.7,'排风扇 40W',fontsize=7)

ax.plot([9,9],[8.5,7.5],'k-',lw=1.5)
draw_switch_sym(ax,(9,7))
ax.text(9,6.5,'4位开关\n1.4m',ha='center',fontsize=7)

# L7
ax.plot([6,6],[6,5.5],'k-',lw=2)
draw_breaker(ax,(6,5),w=1.5,h=0.5,label='DPN 10A/1P',facecolor='lightblue')
ax.text(6,4.5,'L7 电吹风回路  1000W  BV-2.5mm2',ha='center',fontsize=8,fontweight='bold')
ax.plot([6,6],[4.3,3.5],'k-',lw=1.5)
draw_socket_5hole(ax,(6,3))
ax.text(6,2.3,'防水插座 1.5m',ha='center',fontsize=7)

# Warning
ax.text(6,1,'潮湿环境必须安装漏电保护器  |  等电位联结',ha='center',fontsize=10,color='red',fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-3_卫生间回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('4/8 Fig 4-3 done')

# ============================================================
# FIG 4-4: Bedroom Detail
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(12,10))
ax.set_xlim(0,14);ax.set_ylim(0,16);ax.axis('off')
ax.text(7,15.7,'图4-4  主卧小功率电器及照明电气接线回路图',ha='center',fontsize=14,fontweight='bold')

ax.plot([7,7],[15,14.5],'k-',lw=2)
draw_breaker(ax,(7,14),w=2.5,h=0.6,label='DPN 16A/1P  L11回路',facecolor='lightblue')
ax.text(2,14.3,'BV-2.5mm2x3',fontsize=7,color='blue')
ax.plot([7,7],[13.5,13],'k-',lw=1.5)
circle=Circle((7,12.5),0.25,fill=True,facecolor='gray',edgecolor='black');ax.add_patch(circle)
ax.plot([7,7],[13,12.75],'k-',lw=1.5)

# Ceiling light
ax.plot([7,3],[12.25,10.5],'k-',lw=1.2)
ax.plot([3,3],[10.5,9.5],'k-',lw=1)
draw_switch_sym(ax,(3,9),0.35)
ax.text(3,8.5,'开关 1.4m',ha='center',fontsize=7)
ax.plot([3,3],[9,8.2],'k-',lw=1.2)
draw_light_sym(ax,(3,7.5),0.5);ax.text(4,7.2,'吸顶灯 9W',fontsize=9,fontweight='bold')

# Desk
ax.plot([7,7],[12.25,10.5],'k-',lw=1.2)
draw_switch_sym(ax,(6.5,10),0.35)
ax.plot([7,7],[10,9.2],'k-',lw=1.2)
draw_socket_5hole(ax,(7,8.7))
ax.text(7,8,'书桌台灯 7W\n(LED护眼灯)',ha='center',fontsize=8,fontweight='bold')

# Bedside + TV
ax.plot([7,11],[12.25,10.5],'k-',lw=1.2)
ax.plot([11,11],[10.5,8.5],'k-',lw=1.2)
draw_socket_5hole(ax,(11,8));ax.text(11,7.5,'床头x2 0.7m',ha='center',fontsize=7)
ax.plot([11,11],[7.5,7],'k-',lw=1.2)
draw_socket_5hole(ax,(11,6.5));ax.text(11,6,'TV插座 0.65m',ha='center',fontsize=7)

# Wire specs
ax.text(1,3,'BV-2.5mm2铜芯线穿PVC20阻燃管',fontsize=8,color='gray')
ax.text(1,2.5,'L(红)  N(蓝)  PE(黄绿)',fontsize=8)
ax.text(1,2,'86型底盒 | 开关距地1.4m | 普通插座距地0.3m',fontsize=7,color='gray')

fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-4_主卧回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('5/8 Fig 4-4 done')

# ============================================================
# FIG 6-1&2: Combined Lighting Install + Wiring (floor plan)
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(17,11))

# Same floor plan base
wall(0,0,10.5,0);wall(10.5,0,10.5,7.2);wall(10.5,7.2,0,7.2)
wall(0,7.2,0,4.4);wall(0,4.4,1.35,4.4);wall(1.35,4.4,1.35,0);wall(1.35,0,0,0)
wall(1.85,4.4,1.85,7.2,2);wall(3.55,4.4,3.55,7.2,2)
wall(7.2,0,7.2,4.4,2);wall(7.2,4.4,7.2,7.2,2.5)
wall(3.2,0,3.2,4.4,2)
wall(0,4.4,7.2,4.4,2.5);wall(7.2,4.4,10.5,4.4,2.5)
ax.plot([0,10.5],[1.5,1.5],'k-',lw=1,ls='--',dashes=(6,4))

for x,y,name,area in labels:
    ax.text(x,y,f'{name}\\n{area}',ha='center',va='center',fontsize=9 if '客厅' not in name else 12,
            bbox=dict(boxstyle='round,pad=0.2',facecolor='white',alpha=0.8,edgecolor='none'))

# All 17 light points
all_lights = [
    (0.9,6.6,'H1',0.5),(1.6,3.2,'H7',0.5),(2.7,6.6,'H11',0.5),
    (2.2,6.3,'H10',0.4),(4.5,2.5,'H12',0.3),(5.2,0.7,'H17',0.5),
    (5.4,6.6,'H5',0.5),(5.8,3.0,'H14',0.5),(6.5,2.5,'H15',0.3),
    (7.5,2.5,'H13',0.3),(8.8,6.6,'H2',0.5),(8.8,5.8,'H3',0.4),
    (8.8,3.2,'H16',0.5),(10.2,6.8,'H4',0.4),
    (5.4,5.8,'H6',0.4),(1.6,2.5,'H8',0.4),(5.8,2.5,'H9',0.5),
]
for x,y,label,size in all_lights:
    draw_light_sym(ax,(x,y),size)
    ax.text(x,y-0.2,label,ha='center',fontsize=5,fontweight='bold')

# Distribution box
rect=Rectangle((9.5,3.0),0.8,0.6,fill=True,facecolor='red',edgecolor='black',alpha=0.8,lw=1.5)
ax.add_patch(rect)
ax.text(9.9,3.3,'配电箱',fontsize=7,fontweight='bold',color='white')

# Wiring routes (colored dashed)
routes = [
    ('L10',[(1.6,3.2),(2.7,6.6),(2.7,5.5)],'C0','厨房+卫生间',0.5),
    ('L11',[(5.4,6.6),(5.4,5.8),(1.6,2.5),(5.8,2.5)],'C2','卧室+书房',0.5),
    ('L12',[(4.5,2.5),(5.8,3.0),(6.5,2.5),(7.5,2.5),(8.8,3.2),(5.2,0.7)],'C4','公共+阳台',0.5),
]
for name,pts,color,desc,alpha in routes:
    xs=[p[0] for p in pts];ys=[p[1] for p in pts]
    ax.plot(xs,ys,f'{color}--',lw=0.8,alpha=alpha)
    mid=len(pts)//2
    ax.text(pts[mid][0]+0.3,pts[mid][1],f'{name} {desc}',fontsize=5,color=color)

ax.set_xlim(-1.5,12);ax.set_ylim(-2,9);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-1/6-2  灯具安装位置平面图及照明布线示意图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-1_2_照明布线.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('6/8 Fig 6-1/2 done')

# ============================================================
# FIG 6-3: Equipment Installation
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(17,11))
# Floor plan base
for w in [(0,0,10.5,0),(10.5,0,10.5,7.2),(10.5,7.2,0,7.2),(0,7.2,0,4.4),(0,4.4,1.35,4.4),(1.35,4.4,1.35,0),(1.35,0,0,0),
          (1.85,4.4,1.85,7.2),(3.55,4.4,3.55,7.2),(7.2,0,7.2,4.4),(7.2,4.4,7.2,7.2),(3.2,0,3.2,4.4),
          (0,4.4,7.2,4.4),(7.2,4.4,10.5,4.4)]:
    ax.plot([w[0],w[2]],[w[1],w[3]],'k-',lw=2.5)
ax.plot([0,10.5],[1.5,1.5],'k-',lw=1,ls='--')

# Equipment
equip=[
    (9.5,3.5,'DB','配电箱\n1.8m','red'),
    (9.5,2.5,'WC','弱电箱\n0.3m','blue'),
    (9.5,7.0,'AC1','主卧空调\n挂机','cyan'),
    (5.4,7.0,'AC2','次卧空调\n挂机','cyan'),
    (1.6,4.3,'AC3','书房空调\n挂机','cyan'),
    (9.0,2.2,'AC4','客厅空调\n柜机','cyan'),
    (2.7,5.8,'WH','浴霸\n吸顶','orange'),
    (5.2,0.5,'EV','充电桩\n0.3m','green'),
    (5.2,1.2,'WM','洗衣机\n1.0m','purple'),
]
for x,y,code,label,color in equip:
    ax.plot(x,y,'s',color=color,markersize=14,markeredgecolor='black',markeredgewidth=1.5)
    ax.text(x,y,code,ha='center',va='center',fontsize=7,fontweight='bold',color='white')
    ax.text(x,y-0.4,label,ha='center',fontsize=6,color=color)

ax.set_xlim(-1.5,12);ax.set_ylim(-1,9);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-3  电气设备和器件安装位置示意图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-3_设备安装.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('7/8 Fig 6-3 done')

# ============================================================
# FIG 6-4: Socket Installation Plan
# ============================================================
fig,ax=plt.subplots(1,1,figsize=(17,11))
# Floor plan base (same as above)
for w in [(0,0,10.5,0),(10.5,0,10.5,7.2),(10.5,7.2,0,7.2),(0,7.2,0,4.4),(0,4.4,1.35,4.4),(1.35,4.4,1.35,0),(1.35,0,0,0),
          (1.85,4.4,1.85,7.2),(3.55,4.4,3.55,7.2),(7.2,0,7.2,4.4),(7.2,4.4,7.2,7.2),(3.2,0,3.2,4.4),
          (0,4.4,7.2,4.4),(7.2,4.4,10.5,4.4)]:
    ax.plot([w[0],w[2]],[w[1],w[3]],'k-',lw=2.5)
ax.plot([0,10.5],[1.5,1.5],'k-',lw=1,ls='--')

sockets = [
    (1.0,5.5,'油烟机 1.8m','16A三孔','red'),
    (1.0,5.0,'台面x3 1.2m','10A五孔','green'),
    (0.5,4.8,'冰箱 0.3m','10A三孔','green'),
    (2.2,6.8,'吹风机 1.5m','10A五孔防水','blue'),
    (3.0,6.8,'热水器 1.8m','16A三孔','red'),
    (10.3,7.0,'空调 1.8m','16A三孔','red'),
    (10.3,6.8,'床头x2 0.7m','10A五孔','green'),
    (10.3,6.0,'TV 0.65m','10A五孔','green'),
    (6.8,7.0,'空调 1.8m','16A三孔','red'),
    (6.0,6.8,'床头x2 0.7m','10A五孔','green'),
    (3.5,4.3,'空调 1.8m','16A三孔','red'),
    (1.0,2.5,'书桌x3 0.3m','10A五孔','green'),
    (1.0,2.0,'备用 0.3m','10A五孔','green'),
    (9.5,2.0,'空调柜机 0.3m','16A三孔','red'),
    (8.5,3.0,'TV背景x4 0.3m','10A五孔','green'),
    (7.0,2.5,'普通x2 0.3m','10A五孔','green'),
    (8.0,1.0,'洗衣机 1.0m','10A五孔防水','blue'),
    (5.0,1.0,'充电桩 0.3m','10A五孔防水','blue'),
]
for x,y,label,stype,color in sockets:
    marker='s' if '16A' in stype else ('D' if '防水' in stype else 'o')
    ax.plot(x,y,marker,color=color,markersize=10 if '16A' not in stype else 12,
            markeredgecolor='black',markeredgewidth=1,zorder=5)
    ax.text(x,y-0.25,label,ha='center',fontsize=5,rotation=30)

# Legend
for label,color,marker in [('空调/大功率(16A)','red','s'),('防水插座','blue','D'),('普通插座(10A)','green','o')]:
    ax.scatter([],[],c=color,marker=marker,label=label,edgecolors='black',s=30)
ax.legend(loc='lower right',fontsize=8,bbox_to_anchor=(0.95,0.1))

ax.set_xlim(-1.5,12);ax.set_ylim(-1,9);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-4  插座安装平面图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-4_插座平面.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('8/8 Fig 6-4 done')

print(f'\nAll 8 diagrams saved to {OUT}')
for f in sorted(os.listdir(OUT)):
    size=os.path.getsize(os.path.join(OUT,f))/1024
    print(f'  {f} ({size:.0f}KB)')
print('\nDONE')
