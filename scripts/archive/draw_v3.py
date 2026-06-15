#!/usr/bin/env python
"""Professional electrical diagrams v3 - NO text/line overlaps, clean layout."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle, Arc
import sys, os

sys.stdout.reconfigure(encoding='utf-8')
plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False
OUT = r'C:/Users/lb/stock-quant/diagrams_v3'
os.makedirs(OUT, exist_ok=True)
DPI = 200

# ==== Symbols ====
def brk(ax, x, y, w=0.6, h=0.45, label='', fc='white'):
    r = FancyBboxPatch((x-w/2,y-h/2), w, h, boxstyle='round,pad=0.03',
                       fill=True, facecolor=fc, edgecolor='black', lw=1.2)
    ax.add_patch(r)
    ax.plot([x,x],[y+h/2,y+h/2+0.15],'k-',lw=1.5)
    if label: ax.text(x,y,label,ha='center',va='center',fontsize=7,fontweight='bold')

def light(ax,x,y,r=0.25):
    c=Circle((x,y),r,fill=False,edgecolor='black',lw=1.5,zorder=10);ax.add_patch(c)
    ax.plot([x,x],[y,y-r*1.2],'k-',lw=1.2,zorder=9)
    ax.plot([x-r*0.6,x+r*0.6],[y-r*0.2,y-r*0.2],'k-',lw=1.2,zorder=9)

def sw(ax,x,y,r=0.2):
    c=Circle((x,y),r,fill=True,facecolor='white',edgecolor='black',lw=1.5,zorder=10);ax.add_patch(c)
    ax.plot([x,x+r*0.8],[y,y+r*0.4],'k-',lw=1.5,zorder=10)

def s3h(ax,x,y,r=0.25):
    c=Circle((x,y),r,fill=False,edgecolor='black',lw=1.5,zorder=10);ax.add_patch(c)
    ax.plot([x-r*0.7,x+r*0.7],[y,y],'k-',lw=1,zorder=10)
    ax.plot([x-r*0.3,x+r*0.3],[y+r*0.35,y+r*0.35],'k-',lw=1,zorder=10)
    ax.plot([x,x],[y+r*0.35,y-r*0.5],'k-',lw=1,zorder=10)

def s5h(ax,x,y,r=0.25):
    c=Circle((x,y),r,fill=False,edgecolor='black',lw=1.5,zorder=10);ax.add_patch(c)
    ax.plot([x-r*0.7,x+r*0.7],[y,y],'k-',lw=1,zorder=10)
    ax.plot([x-r*0.3,x+r*0.3],[y-r*0.35,y-r*0.35],'k-',lw=1,zorder=10)
    ax.plot([x-r*0.3,x+r*0.3],[y+r*0.35,y+r*0.35],'k-',lw=1,zorder=10)
    ax.plot([x,x],[y-r*0.35,y+r*0.35],'k-',lw=1,zorder=10)

def wall(x1,y1,x2,y2,lw=3):
    ax.plot([x1,x2],[y1,y2],'k-',lw=lw,solid_capstyle='round')

def rlabel(ax,x,y,text,fs=9):
    ax.text(x,y,text,ha='center',va='center',fontsize=fs,
            bbox=dict(boxstyle='round,pad=0.2',facecolor='white',alpha=0.85,edgecolor='none'))

def slabel(ax,x,y,text,color='black',fs=8):
    ax.text(x+0.4,y,text,ha='left',va='center',fontsize=fs,color=color,
            bbox=dict(facecolor='white',alpha=0.85,edgecolor='none',pad=0.5))

# ======================================================
# FIG 3-1: Lighting Floor Plan
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(18,13))
# Outer walls
for(a,b,c,d,l)in[(0,0,10.5,0,3.5),(10.5,0,10.5,7.2,3.5),(10.5,7.2,0,7.2,3.5),
    (0,7.2,0,4.4,3.5),(0,4.4,1.35,4.4,3.5),(1.35,4.4,1.35,0,3.5),(1.35,0,0,0,3.5)]:
    wall(a,b,c,d,l)
for(a,b,c,d,l)in[(1.85,4.4,1.85,7.2,2.5),(3.55,4.4,3.55,7.2,2.5),
    (7.2,0,7.2,4.4,2.5),(7.2,4.4,7.2,7.2,2.5),(3.2,0,3.2,4.4,2),
    (0,4.4,7.2,4.4,2.5),(7.2,4.4,10.5,4.4,2.5)]:
    wall(a,b,c,d,l)
ax.plot([0,10.5],[1.5,1.5],color='black',lw=1.2,ls='--',dashes=(8,6))
# Doors
ax.add_patch(Arc((3.55,5.5),1.3,1.3,theta1=90,theta2=180,color='gray',lw=1,ls='--'))
ax.plot([3.55,3.55],[5.3,6.7],'white',lw=5)
ax.add_patch(Arc((7.2,3.2),1.4,1.4,theta1=0,theta2=90,color='gray',lw=1,ls='--'))
ax.plot([7.2,7.2],[3.0,4.4],'white',lw=5)

# Room labels
for x,y,n,a in[(0.68,5.8,'厨房','4.1m2'),(2.7,5.8,'卫生间','2.6m2'),(5.4,5.8,'次卧室','8.5m2'),
    (8.85,5.8,'主卧室','10.6m²'),(1.6,2.8,'书房','9.1m²'),(5.7,3.0,'客    厅','15.6m²'),(5.25,0.75,'阳台','12.9m²')]:
    rlabel(ax,x,y,f'{n}\n{a}',12 if '客厅' in n else 9)

# Dims (outside, with white bg)
def dline(x1,x2,y,ty,txt):
    ax.plot([x1,x2],[y,y],'k-',lw=0.8)
    ax.plot([x1,x1],[y,y+0.2],'k-',lw=0.8);ax.plot([x2,x2],[y,y+0.2],'k-',lw=0.8)
    ax.text((x1+x2)/2,ty,txt,ha='center',fontsize=8,fontweight='bold',bbox=dict(facecolor='white',alpha=0.9,edgecolor='none',pad=1))
dline(0,3.2,-0.4,-0.8,'3200');dline(3.2,7.2,-0.4,-0.8,'4000');dline(7.2,10.5,-0.4,-0.8,'3300')
dline(0,1.85,7.4,7.8,'1850');dline(1.85,3.55,7.4,7.8,'1700');dline(3.55,7.2,7.4,7.8,'3650');dline(7.2,10.5,7.4,7.8,'3300')

# Light points
pts=[(0.9,6.3,'1','c'),(2.7,5.6,'11','c'),(2.2,6.5,'10','m'),(5.4,6.3,'5','c'),
    (5.4,5.5,'6','d'),(8.85,6.3,'2','c'),(8.85,5.5,'3','d'),(10.0,6.8,'4','b'),
    (1.6,3.5,'7','c'),(1.6,2.5,'8','d'),(5.7,3.5,'14','c'),(4.5,2.8,'12','e'),
    (6.5,2.8,'13','e'),(8.0,2.8,'15','e'),(9.0,3.5,'16','c'),(8.85,3.8,'9','c'),(5.25,0.7,'17','c')]
for x,y,lab,typ in pts:
    if typ=='c':light(ax,x,y)
    elif typ in('d','b','m'):ax.plot(x,y,'s',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=10)
    elif typ=='e':ax.plot(x,y,'^',color='white',markersize=8,markeredgecolor='black',markeredgewidth=1.5,zorder=10)
    slabel(ax,x,y,lab,'black',7)

# Legend
lx,ly=0.3,-1.8
light(ax,lx,ly,0.2);ax.text(lx+0.4,ly,'普通照明(吸顶灯)',fontsize=8,va='center')
lx2=lx+3.8;ax.plot(lx2,ly,'s',color='white',markersize=6,markeredgecolor='black',markeredgewidth=1.5);ax.text(lx2+0.4,ly,'点照明(台灯/镜前灯)',fontsize=8,va='center')
lx3=lx2+5.5;ax.plot(lx3,ly,'^',color='white',markersize=6,markeredgecolor='black',markeredgewidth=1.5);ax.text(lx3+0.4,ly,'装饰照明(筒灯)',fontsize=8,va='center')

ax.set_xlim(-1.5,12);ax.set_ylim(-2.5,9.5);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图3-1  照明分布图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图3-1_照明分布图.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('1/8 Fig 3-1')

# ======================================================
# FIG 4-1: System One-line
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(16,14))
ax.set_xlim(0,20);ax.set_ylim(0,35);ax.axis('off')
Y=34
ax.plot([9.5,9.5],[Y,Y+1.5],'k-',lw=3,solid_capstyle='round')
ax.text(9.5,Y+1.8,'AC 220V 单相  BV-16mm²×2+PE',ha='center',fontsize=9,fontweight='bold')
Y-=1.5
r=FancyBboxPatch((7,Y-0.5),5,1,boxstyle='round',facecolor='lightyellow',edgecolor='black',lw=1.2);ax.add_patch(r)
ax.text(9.5,Y,'电能表  DD862-4  20(80)A',ha='center',fontsize=9,fontweight='bold')
Y-=2
brk(ax,9.5,Y,2.2,0.7,'63A/2P 漏保','lightgray')
Y-=2
ax.plot([2,17],[Y,Y],'k-',lw=4,solid_capstyle='round');ax.text(17.5,Y,'380/220V AC Bus',fontsize=7,va='center')
# Left 6 circuits
for i in range(6):
    cy=Y-1.5-i*2.3;ax.plot([3.5,3.5],[Y-0.3,cy+0.5],'k-',lw=1.2)
    brk(ax,3.5,cy,1.6,0.45,f'L{i+1}','lightblue')
    ax.plot([3.5,3.5],[cy-0.3,cy-1.3],'k-',lw=1.2)
    info=['主卧空调','次卧空调','书房空调','客厅空调','电动车充电','浴霸(漏保)'][i]
    spec=['2100W 4mm² 20A','1800W 4mm² 20A','1800W 4mm² 20A','2400W 4mm² 25A','350W 1.5mm² 10A','1000W 2.5mm² 10A'][i]
    ax.text(3.5,cy-1.5,info,ha='center',fontsize=8,fontweight='bold')
    ax.text(3.5,cy-1.9,spec,ha='center',fontsize=6.5,color='gray')
# Right 6 circuits
for i in range(6):
    cy=Y-1.5-i*2.3;ax.plot([15.5,15.5],[Y-0.3,cy+0.5],'k-',lw=1.2)
    brk(ax,15.5,cy,1.6,0.45,f'L{i+7}','lightblue')
    ax.plot([15.5,15.5],[cy-0.3,cy-1.3],'k-',lw=1.2)
    info=['吹风机','厨房大功率1','微波炉','厨房普通+灯','卧室+书房','公共+阳台'][i]
    spec=['1000W 2.5mm² 10A','3500W 4mm² 20A(漏保)','800W 2.5mm² 10A','1180W 2.5mm² 10A(漏保)','2500W 2.5mm² 16A','2000W 2.5mm² 16A'][i]
    ax.text(15.5,cy-1.5,info,ha='center',fontsize=8,fontweight='bold')
    ax.text(15.5,cy-1.9,spec,ha='center',fontsize=6.5,color='gray')
# N/PE
ax.plot([18.5,18.5],[Y-0.5,Y-15.5],'b-',lw=2)
ax.text(18.5,Y-8,'N',fontsize=10,color='blue',fontweight='bold',ha='center',bbox=dict(facecolor='white',edgecolor='none'))
ax.plot([19.2,19.2],[Y-0.5,Y-15.5],'g-',lw=2)
ax.text(19.2,Y-8,'PE',fontsize=10,color='green',fontweight='bold',ha='center',bbox=dict(facecolor='white',edgecolor='none'))
ax.set_title('图4-1  供配电系统图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-1_供配电系统图.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('2/8 Fig 4-1')

# ======================================================
# FIG 4-2: High Power Circuits
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(14,8))
ax.set_xlim(0,16);ax.set_ylim(0,14);ax.axis('off')
ax.text(8,13.7,'图4-2  大功率用电器及插座电气回路图',ha='center',fontsize=14,fontweight='bold')
for bx,lb,desc,pw,wire,bkr,clr in[(2,'L1','主卧空调','2100W','4mm²','DPN 20A','#E74C3C'),
    (4,'L2','次卧空调','1800W','4mm²','DPN 20A','#E67E22'),(6,'L3','书房空调','1800W','4mm²','DPN 20A','#F39C12'),
    (8,'L4','客厅空调','2400W','4mm²','DPN 25A','#27AE60'),(10,'L5','电动车充电','350W','1.5mm²','DPN 10A','#3498DB'),
    (12,'L8','电磁炉+水壶','3500W','4mm²','DPN 20A漏','#8E44AD'),(14,'L9','微波炉','800W','2.5mm²','DPN 10A','#16A085')]:
    ax.plot([bx,bx],[13,12],'k-',lw=2);brk(ax,bx,11.3,1.5,0.5,bkr,clr)
    ax.plot([bx,bx],[11,10],'k-',lw=1.5);ax.text(bx+0.5,10.5,wire,fontsize=7,color='blue')
    s3h(ax,bx,9.3);ax.plot([bx,bx],[9,8.3],'k-',lw=1.5)
    r=FancyBboxPatch((bx-1.3,7.8),2.6,0.7,boxstyle='round',facecolor=clr,edgecolor='black',alpha=0.25);ax.add_patch(r)
    ax.text(bx,8.25,lb,ha='center',fontsize=8,fontweight='bold');ax.text(bx,7.85,desc,ha='center',fontsize=7);ax.text(bx,7.55,pw,ha='center',fontsize=6.5,color='gray')
    ax.plot([bx,bx],[7.2,6.8],'g-',lw=1);ax.plot([bx-0.4,bx+0.4],[6.8,6.8],'g-',lw=1.5);ax.plot([bx-0.25,bx+0.25],[6.5,6.5],'g-',lw=1.5)
ax.text(1.5,5,'L(红)火线  N(蓝)零线  PE(黄绿)地线  空调插座16A三孔  厨房大功率16A三孔',fontsize=8,color='gray')
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-2_大功率回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('3/8 Fig 4-2')

# ======================================================
# FIG 4-3: Bath Circuit
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(10,8))
ax.set_xlim(0,14);ax.set_ylim(0,16);ax.axis('off')
ax.text(7,15.7,'图4-3  卫生间浴霸及吹风机电气回路接线图',ha='center',fontsize=14,fontweight='bold')
ax.plot([6,6],[14.5,14],'k-',lw=2);brk(ax,6,13.5,2.5,0.6,'DPN 10A/1P + 漏电保护','#FFCCCC')
ax.text(6,13,'L6  浴霸  1000W  2.5mm²',ha='center',fontsize=9,fontweight='bold')
ax.plot([6,6],[12.8,12],'k-',lw=1.5)
c=Circle((6,11.5),0.3,fill=True,facecolor='gray',edgecolor='black',lw=1.5);ax.add_patch(c)
ax.text(6,11.5,'J',ha='center',va='center',fontsize=7,fontweight='bold',color='white')
ax.plot([6,2.5],[11.2,9.5],'k-',lw=1.2);ax.plot([6,9.5],[11.2,9.5],'k-',lw=1.2)
r=FancyBboxPatch((1,8),3,2.2,boxstyle='round',facecolor='#FFE0B2',edgecolor='black',alpha=0.5,lw=1.5);ax.add_patch(r)
ax.text(2.5,9.6,'浴霸主机',ha='center',fontsize=10,fontweight='bold')
ax.text(2.5,9.0,'取暖灯 275W×2',ha='center',fontsize=8);ax.text(2.5,8.5,'照明灯 60W',ha='center',fontsize=8);ax.text(2.5,8.0,'排风扇 40W',ha='center',fontsize=8)
ax.plot([9.5,9.5],[9.5,8.8],'k-',lw=1.2);sw(ax,9.5,8.5)
ax.text(9.5,8.0,'4位开关',ha='center',fontsize=7);ax.text(9.5,7.6,'1.4m',ha='center',fontsize=7)
ax.plot([6,6],[7,6.5],'k-',lw=2);brk(ax,6,6,1.5,0.5,'DPN 10A/1P','#CCE5FF')
ax.text(6,5.5,'L7  电吹风  1000W  2.5mm²',ha='center',fontsize=9,fontweight='bold')
ax.plot([6,6],[5.3,4.5],'k-',lw=1.5);s5h(ax,6,4);ax.text(6,3.4,'防水插座  1.5m',ha='center',fontsize=8)
ax.text(7,2,' 潮湿环境必须安装漏电保护器  |  等电位联结',ha='center',fontsize=10,color='red',fontweight='bold',bbox=dict(facecolor='white',edgecolor='none',pad=3))
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-3_卫生间回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('4/8 Fig 4-3')

# ======================================================
# FIG 4-4: Bedroom Circuit
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(12,10))
ax.set_xlim(0,14);ax.set_ylim(0,16);ax.axis('off')
ax.text(7,15.7,'图4-4  主卧小功率电器及照明电气接线回路图(L11)',ha='center',fontsize=14,fontweight='bold')
ax.plot([7,7],[15,14.5],'k-',lw=2);brk(ax,7,14,2.5,0.6,'DPN 16A/1P  L11','#CCE5FF')
ax.text(2,14.3,'BV-2.5mm²×3',fontsize=7,color='blue')
ax.plot([7,7],[13.8,13.2],'k-',lw=1.5)
c=Circle((7,12.8),0.25,fill=True,facecolor='gray',edgecolor='black',lw=1.5);ax.add_patch(c)
ax.plot([7,2.5],[12.55,10.5],'k-',lw=1.2);ax.plot([2.5,2.5],[10.5,9.5],'k-',lw=1);sw(ax,2.5,9)
ax.text(2.5,8.5,'开关 1.4m',ha='center',fontsize=7);ax.plot([2.5,2.5],[8.5,7.8],'k-',lw=1.2)
light(ax,2.5,7.3,0.3);ax.text(3.8,7.3,'吸顶灯 9W',fontsize=9,fontweight='bold',va='center')
ax.text(3.8,6.8,'T5环形管+电子镇流器',fontsize=7,color='gray')
ax.plot([7,7],[12.55,10.5],'k-',lw=1.2);sw(ax,6.3,10);ax.plot([7,7],[10,9.2],'k-',lw=1.2)
s5h(ax,7,8.7);ax.text(7,8.1,'书桌台灯 7W(LED)',ha='center',fontsize=9,fontweight='bold')
ax.plot([7,11],[12.55,10.5],'k-',lw=1.2);ax.plot([11,11],[10.5,8.5],'k-',lw=1.2)
s5h(ax,11,8);ax.text(11,7.4,'床头×2  0.7m',ha='center',fontsize=8)
ax.plot([11,11],[7.4,6.8],'k-',lw=1.2);s5h(ax,11,6.3);ax.text(11,5.7,'TV插座  0.65m',ha='center',fontsize=8)
ax.text(1,3.5,'BV-2.5mm²铜芯导线  PVC20阻燃管暗敷  L(红) N(蓝) PE(黄绿)',fontsize=8,color='gray')
ax.text(1,3.0,'86型底盒  开关距地1.4m  普通插座距地0.3m',fontsize=7,color='gray')
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图4-4_主卧回路.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('5/8 Fig 4-4')

# ======================================================
# FIG 6-1/2: Lighting Install + Wiring
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(18,12))
for(a,b,c,d,l)in[(0,0,10.5,0,3.5),(10.5,0,10.5,7.2,3.5),(10.5,7.2,0,7.2,3.5),(0,7.2,0,4.4,3.5),(0,4.4,1.35,4.4,3.5),(1.35,4.4,1.35,0,3.5),(1.35,0,0,0,3.5),(1.85,4.4,1.85,7.2,2.5),(3.55,4.4,3.55,7.2,2.5),(7.2,0,7.2,4.4,2.5),(7.2,4.4,7.2,7.2,2.5),(3.2,0,3.2,4.4,2),(0,4.4,7.2,4.4,2.5),(7.2,4.4,10.5,4.4,2.5)]:wall(a,b,c,d,l)
ax.plot([0,10.5],[1.5,1.5],color='black',lw=1.2,ls='--',dashes=(8,6))
ax.add_patch(Arc((3.55,5.5),1.3,1.3,theta1=90,theta2=180,color='gray',lw=1,ls='--'));ax.plot([3.55,3.55],[5.3,6.7],'white',lw=5)
ax.add_patch(Arc((7.2,3.2),1.4,1.4,theta1=0,theta2=90,color='gray',lw=1,ls='--'));ax.plot([7.2,7.2],[3.0,4.4],'white',lw=5)
for x,y,n,a in[(0.68,5.8,'厨房','4.1m2'),(2.7,5.8,'卫生间','2.6m2'),(5.4,5.8,'次卧室','8.5m2'),(8.85,5.8,'主卧室','10.6m²'),(1.6,2.8,'书房','9.1m²'),(5.7,3.0,'客    厅','15.6m²'),(5.25,0.75,'阳台','12.9m²')]:rlabel(ax,x,y,f'{n}\n{a}',12 if '客厅' in n else 9)
all_l=[(0.9,6.3,'H1'),(2.7,5.6,'H11'),(2.2,6.5,'H10'),(5.4,6.3,'H5'),(5.4,5.5,'H6'),(8.85,6.3,'H2'),(8.85,5.5,'H3'),(10.0,6.8,'H4'),(1.6,3.5,'H7'),(1.6,2.5,'H8'),(5.7,3.5,'H14'),(4.5,2.8,'H12'),(6.5,2.8,'H13'),(8.0,2.8,'H15'),(9.0,3.5,'H16'),(8.85,3.8,'H9'),(5.25,0.7,'H17')]
for x,y,lab in all_l:light(ax,x,y,0.22);slabel(ax,x,y,lab,'black',6)
db=Rectangle((0.9,3.8),0.6,0.5,fill=True,facecolor='red',edgecolor='black',alpha=0.8,lw=1.5);ax.add_patch(db)
ax.text(1.2,4.05,'DB',ha='center',fontsize=7,fontweight='bold',color='white')
routes={'L10':'#FF6B6B','L11':'#4ECDC4','L12':'#45B7D1','L11B':'#96CEB4'}
pts_map={'L10':[(1.2,4.05),(0.9,6.3),(2.2,6.5),(2.7,5.6)],'L11':[(1.2,4.05),(1.6,3.5),(5.4,6.3),(5.4,5.5),(1.6,2.5),(5.7,3.5)],'L12':[(1.2,4.05),(5.25,0.7),(4.5,2.8),(6.5,2.8),(8.0,2.8),(9.0,3.5)],'L11B':[(1.2,4.05),(8.85,3.8),(8.85,6.3),(8.85,5.5),(10.0,6.8)]}
for name,clr in routes.items():
    xs=[p[0]for p in pts_map[name]];ys=[p[1]for p in pts_map[name]]
    ax.plot(xs,ys,color=clr,lw=1.5,ls='--',alpha=0.6);ax.text(xs[-1]+0.2,ys[-1]-0.2,name,fontsize=6,color=clr,fontweight='bold')
ax.set_xlim(-1.5,12);ax.set_ylim(-1.5,9.5);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-1/6-2  灯具安装位置平面图及照明布线示意图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-1_2_照明布线.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('6/8 Fig 6-1/2')

# ======================================================
# FIG 6-3: Equipment Install
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(18,12))
for(a,b,c,d,l)in[(0,0,10.5,0,3.5),(10.5,0,10.5,7.2,3.5),(10.5,7.2,0,7.2,3.5),(0,7.2,0,4.4,3.5),(0,4.4,1.35,4.4,3.5),(1.35,4.4,1.35,0,3.5),(1.35,0,0,0,3.5),(1.85,4.4,1.85,7.2,2.5),(3.55,4.4,3.55,7.2,2.5),(7.2,0,7.2,4.4,2.5),(7.2,4.4,7.2,7.2,2.5),(3.2,0,3.2,4.4,2),(0,4.4,7.2,4.4,2.5),(7.2,4.4,10.5,4.4,2.5)]:wall(a,b,c,d,l)
ax.plot([0,10.5],[1.5,1.5],color='black',lw=1.2,ls='--',dashes=(8,6))
for x,y,n,a in[(0.68,5.8,'厨房','4.1m2'),(2.7,5.8,'卫生间','2.6m2'),(5.4,5.8,'次卧室','8.5m2'),(8.85,5.8,'主卧室','10.6m²'),(1.6,2.8,'书房','9.1m²'),(5.7,3.0,'客    厅','15.6m²'),(5.25,0.75,'阳台','12.9m²')]:rlabel(ax,x,y,f'{n}\n{a}',12 if '客厅' in n else 9)
eq=[(0.9,3.8,'DB','配电箱','1.8m','red'),(1.2,2.8,'WC','弱电箱','0.3m','blue'),(10.0,7.0,'AC','主卧空调','1.8m','#00BCD4'),(6.5,7.0,'AC','次卧空调','1.8m','#00BCD4'),(3.5,4.3,'AC','书房空调','1.8m','#00BCD4'),(9.5,2.5,'AC','客厅柜机','0.3m','#00BCD4'),(2.7,6.0,'WH','浴霸','吸顶','orange'),(5.25,0.5,'EV','充电桩','0.3m','green'),(8.0,1.0,'WM','洗衣机','1.0m','purple')]
for x,y,code,name,h,c in eq:
    ax.plot(x,y,'s',color=c,markersize=14,markeredgecolor='black',markeredgewidth=1.5,zorder=10)
    ax.text(x,y,code,ha='center',va='center',fontsize=7,fontweight='bold',color='white',zorder=11)
    slabel(ax,x,y,f'{name} {h}',c,7)
ax.set_xlim(-1.5,12);ax.set_ylim(-1,9.5);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-3  电气设备和器件安装位置示意图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-3_设备安装.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('7/8 Fig 6-3')

# ======================================================
# FIG 6-4: Socket Plan
# ======================================================
fig,ax=plt.subplots(1,1,figsize=(18,12))
for(a,b,c,d,l)in[(0,0,10.5,0,3.5),(10.5,0,10.5,7.2,3.5),(10.5,7.2,0,7.2,3.5),(0,7.2,0,4.4,3.5),(0,4.4,1.35,4.4,3.5),(1.35,4.4,1.35,0,3.5),(1.35,0,0,0,3.5),(1.85,4.4,1.85,7.2,2.5),(3.55,4.4,3.55,7.2,2.5),(7.2,0,7.2,4.4,2.5),(7.2,4.4,7.2,7.2,2.5),(3.2,0,3.2,4.4,2),(0,4.4,7.2,4.4,2.5),(7.2,4.4,10.5,4.4,2.5)]:wall(a,b,c,d,l)
ax.plot([0,10.5],[1.5,1.5],color='black',lw=1.2,ls='--',dashes=(8,6))
for x,y,n,a in[(0.68,5.8,'厨房','4.1m2'),(2.7,5.8,'卫生间','2.6m2'),(5.4,5.8,'次卧室','8.5m2'),(8.85,5.8,'主卧室','10.6m²'),(1.6,2.8,'书房','9.1m²'),(5.7,3.0,'客    厅','15.6m²'),(5.25,0.75,'阳台','12.9m²')]:rlabel(ax,x,y,f'{n}\n{a}',12 if '客厅' in n else 9)
sk=[(0.7,5.3,'油烟机','1.8m','16A','red','^'),(1.0,4.8,'台面×3','1.2m','10A','green','o'),(0.5,5.0,'冰箱','0.3m','10A','green','o'),(2.2,6.8,'吹风机','1.5m','防水','blue','D'),(3.0,6.8,'热水器','1.8m','16A','red','^'),(10.3,7.0,'空调','1.8m','16A','red','^'),(10.3,6.5,'床头×2','0.7m','10A','green','o'),(10.3,6.0,'TV','0.65m','10A','green','o'),(6.5,7.0,'空调','1.8m','16A','red','^'),(6.0,6.5,'床头×2','0.7m','10A','green','o'),(3.5,4.3,'空调','1.8m','16A','red','^'),(1.6,2.5,'书桌','0.3m','10A','green','o'),(9.5,2.0,'柜机','0.3m','16A','red','^'),(8.8,3.0,'TV墙×3','0.3m','10A','green','o'),(7.2,2.5,'备用','0.3m','10A','green','o'),(5.25,1.0,'洗衣机','1.0m','防水','blue','D'),(7.5,1.0,'充电桩','0.3m','防水','blue','D')]
for x,y,name,h,typ,c,m in sk:
    sz=12 if '16A' in typ else 10;ax.plot(x,y,m,color=c,markersize=sz,markeredgecolor='black',markeredgewidth=1.2,zorder=10)
    slabel(ax,x,y,f'{name} {h} {typ}',c,5.5)
for ln,c,m in[('空调/大功率(16A)','red','^'),('防水插座','blue','D'),('普通插座(10A)','green','o')]:
    ax.scatter([],[],c=c,marker=m,label=ln,edgecolors='black',s=40,zorder=10)
ax.legend(loc='lower right',fontsize=8,bbox_to_anchor=(0.95,0.05),title='插座类型')
ax.set_xlim(-1.5,12);ax.set_ylim(-1.5,9.5);ax.set_aspect('equal');ax.axis('off')
ax.set_title('图6-4  插座安装平面图',fontsize=14,fontweight='bold',pad=15)
fig.tight_layout()
fig.savefig(os.path.join(OUT,'图6-4_插座平面.png'),dpi=DPI,bbox_inches='tight')
plt.close()
print('8/8 Fig 6-4')

print(f'\nSaved to {OUT}')
for f in sorted(os.listdir(OUT)):
    print(f'  {f} ({os.path.getsize(os.path.join(OUT,f))/1024:.0f}KB)')
print('DONE')
