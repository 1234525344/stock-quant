#!/usr/bin/env python
"""Generate all electrical engineering diagrams for the course design report."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Rectangle, FancyBboxPatch, Circle, Arc, FancyArrowPatch, ConnectionPatch
import numpy as np
import sys, os

sys.stdout.reconfigure(encoding='utf-8')
plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

OUT = r'C:/Users/lb/stock-quant/diagrams'
os.makedirs(OUT, exist_ok=True)
DPI = 150

# ===== ROOM DIMENSIONS (mm) =====
# Living room: 3900x4500, master BR: 3400x3600, 2nd BR: 3000x3300
# Study: 3200x3300, Kitchen: 1850x2800, Bath: 1700x2000, Balcony: 10500x1500
# Scale: 1mm = 0.01 units

def draw_floor_base(ax, show_rooms=True):
    """Draw the L-shaped floor plan base."""
    # Main rectangle
    outer = Rectangle((0, 0), 10.5, 7.2, fill=False, color='black', linewidth=2)
    ax.add_patch(outer)

    # L-shape notch (top-left, kitchen area recessed)
    # Notch from x=0 to x=1.35, y=4.4 to y=7.2
    notch_x = [0, 1.35, 1.35, 0]
    notch_y = [4.4, 4.4, 7.2, 7.2]

    # Draw walls
    # Horizontal walls (top to bottom)
    # Top wall (kitchen+bath+bedroom area)
    ax.plot([0, 1.85], [7.2, 7.2], 'k-', lw=2)  # kitchen top
    ax.plot([1.85, 3.55], [7.2, 7.2], 'k-', lw=2)  # bath top
    ax.plot([3.55, 7.2], [7.2, 7.2], 'k-', lw=2)  # 2nd bedroom top left
    ax.plot([7.2, 10.5], [7.2, 7.2], 'k-', lw=2)  # master BR top

    # Middle horizontal wall (separates upper rooms from living room)
    ax.plot([1.85, 7.2], [4.4, 4.4], 'k-', lw=2)
    ax.plot([7.2, 10.5], [4.4, 4.4], 'k-', lw=2)

    # Bottom wall
    ax.plot([0, 10.5], [0, 0], 'k-', lw=2)

    # Vertical walls
    ax.plot([0, 0], [0, 7.2], 'k-', lw=2)  # left exterior
    ax.plot([10.5, 10.5], [0, 7.2], 'k-', lw=2)  # right exterior
    ax.plot([1.85, 1.85], [4.4, 7.2], 'k-', lw=2)  # kitchen right wall
    ax.plot([3.55, 3.55], [4.4, 7.2], 'k-', lw=2)  # bath right wall
    ax.plot([7.2, 7.2], [0, 7.2], 'k-', lw=1.5)  # master BR left wall
    ax.plot([3.2, 3.2], [0, 4.4], 'k-', lw=1.5)  # study right wall
    ax.plot([1.35, 1.35], [0, 4.4], 'k-', lw=1)  # kitchen notch bottom wall (just a guide)

    # Kitchen notch vertical wall
    ax.plot([1.35, 1.35], [0, 4.4], 'k-', lw=2)

    # Balcony line
    ax.plot([0, 10.5], [1.5, 1.5], 'k-', lw=1, linestyle='--')

    if show_rooms:
        # Room labels
        ax.text(1.6, 5.8, 'Kitchen\n4.1m²', ha='center', fontsize=7)
        ax.text(2.7, 5.8, 'Bath\n2.6m²', ha='center', fontsize=7)
        ax.text(5.4, 5.8, '2nd Bedroom\n8.5m²', ha='center', fontsize=7)
        ax.text(8.8, 5.8, 'Master Bedroom\n10.6m²', ha='center', fontsize=7)
        ax.text(2.2, 2.2, 'Study\n9.1m²', ha='center', fontsize=7)
        ax.text(6.8, 2.2, 'Living Room\n15.6m²', ha='center', fontsize=10)
        ax.text(5.2, 0.75, 'Balcony 12.9m²', ha='center', fontsize=7)

        # Aisle
        ax.text(8.8, 3.5, 'Aisle', ha='center', fontsize=6, color='gray')

    ax.set_xlim(-0.5, 11.5)
    ax.set_ylim(-0.5, 8)
    ax.set_aspect('equal')
    ax.axis('off')

# =================================================================
# Figure 3-1: 照明分布图
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(12, 9))
draw_floor_base(ax, show_rooms=False)

# Lighting points (17 total)
lights = [
    (1.85/2, 6.5, '1', '普通'),          # 1 kitchen center
    (1.85+1.7/2, 6.5, '10', '点'),       # 10 bath mirror
    (1.85+1.7/2, 5.8, '11', '普通'),      # 11 bath center
    (3.55+(7.2-3.55)/2, 6.5, '5', '普通'), # 5 2nd BR center
    (3.55+(7.2-3.55)/2, 6.0, '6', '点'),   # 6 2nd BR desk
    (7.2+(10.5-7.2)/2, 6.5, '2', '普通'),  # 2 master BR center
    (9.3, 6.0, '3', '点'),                  # 3 master BR desk
    (9.3, 6.8, '4', '普通'),                # 4 master BR bedside
    (1.85+1.7/2, 3.5, '7', '普通'),         # 7 study center
    (1.85+1.7/2, 3.0, '8', '点'),           # 8 study desk
    (3.2+(7.2-3.2)/2, 3.0, '9', '普通'),    # 9 study area
    (7.2+(10.5-7.2)/2, 3.0, '14', '普通'),  # 14 living center
    (8.5, 2.5, '15', '装饰'),                # 15 living decor
    (5.5, 2.0, '12', '装饰'),                # 12 living decor
    (9.5, 2.0, '16', '装饰'),                # 16 living decor
    (6.5, 1.8, '13', '装饰'),                # 13 living decor
    (5, 3.5, '17', '普通'),                  # 17 aisle
]

for x, y, label, ltype in lights:
    color = 'orange' if ltype == '普通' else ('blue' if ltype == '点' else 'green')
    marker = 'o' if ltype == '普通' else ('s' if ltype == '点' else '^')
    ax.plot(x, y, marker, color=color, markersize=10, markeredgecolor='black', markeredgewidth=1)
    ax.text(x, y+0.15, label, ha='center', fontsize=6, fontweight='bold')

# Legend
for ltype, color, marker in [('普通照明', 'orange', 'o'), ('点照明', 'blue', 's'), ('装饰照明', 'green', '^')]:
    ax.scatter([], [], c=color, marker=marker, label=ltype, edgecolors='black', s=50)
ax.legend(loc='lower right', fontsize=8, title='照明类别')
ax.set_title('图3-1 照明分布图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig3_1_lighting.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('1. Fig 3-1 done')

# =================================================================
# Figure 4-1: 供配电系统图 (One-line diagram)
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(14, 10))
ax.set_xlim(0, 20)
ax.set_ylim(0, 30)
ax.axis('off')

# Utility power inlet
ax.plot([10, 10], [28, 29], 'k-', lw=4)
ax.text(10, 29.3, '220V 单相电源进线', ha='center', fontsize=9, fontweight='bold')
ax.text(10, 27.8, 'BV-16mm²×2+PE', ha='center', fontsize=7, color='gray')

# kWh meter
rect = FancyBboxPatch((8.5, 27), 3, 1, boxstyle='round,pad=0.1', fill=True, facecolor='lightyellow', edgecolor='black')
ax.add_patch(rect)
ax.text(10, 27.5, '电能表', ha='center', fontsize=9, fontweight='bold')
ax.text(10, 27.0, 'DD862 20(80)A', ha='center', fontsize=7)

# Main breaker
rect2 = FancyBboxPatch((8.5, 25.5), 3, 1, boxstyle='round,pad=0.1', fill=True, facecolor='lightgray', edgecolor='black')
ax.add_patch(rect2)
ax.text(10, 26.0, '总空开 63A/2P+漏保', ha='center', fontsize=8, fontweight='bold')

# Bus bar
ax.plot([7, 13], [25, 25], 'k-', lw=3)
ax.text(13.3, 25, '母线', fontsize=7, va='center')

# 12 branch circuits
circuits = [
    ('L1', '主卧空调', '20A', 2100, 12),
    ('L2', '次卧空调', '20A', 1800, 11),
    ('L3', '书房空调', '20A', 1800, 10),
    ('L4', '客厅空调', '25A', 2400, 9),
    ('L5', '电动车充电', '10A', 350, 8),
    ('L6', '卫生间浴霸', '10A+漏保', 1000, 7),
    ('L7', '卫生间吹风机', '10A', 1000, 6),
    ('L8', '厨房大功率一', '20A+漏保', 3500, 5),
    ('L9', '厨房大功率二', '10A', 800, 4),
    ('L10', '厨房普通+照明', '10A+漏保', 700, 3),
    ('L11', '卧室书房小功率', '25A', 2500, 2),
    ('L12', '公共区域+阳台', '16A', 2000, 1),
]

for label, desc, breaker, power, y in circuits:
    x_start = 3 + (y-1) % 2 * 7
    # Breaker symbol
    rect = FancyBboxPatch((x_start, 22.5 + (y-1)//2 * 0.8), 2.5, 0.6,
                          boxstyle='round,pad=0.05', fill=True, facecolor='white', edgecolor='black')
    ax.add_patch(rect)
    ax.text(x_start+1.25, 22.8 + (y-1)//2 * 0.8, f'{label}: {breaker}', ha='center', fontsize=7)
    ax.text(x_start+1.25, 22.1 + (y-1)//2 * 0.8, f'{desc} ({power}W)', ha='center', fontsize=6, color='gray')

ax.set_title('图4-1 供配电系统图（12回路）', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig4_1_system.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('2. Fig 4-1 done')

# =================================================================
# Figure 4-2: 空调等大功率回路图
# =================================================================
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
for ax in [ax1, ax2]:
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis('off')

# Left: L1-L4 air conditioner circuits
ax1.set_title('L1-L4 空调回路', fontsize=12, fontweight='bold')
ax1.text(5, 9.5, '配电箱引出', ha='center', fontsize=9)
# Bus
ax1.plot([5,5], [9, 8.5], 'k-', lw=2)
# 4 branches
for i, (label, room, power) in enumerate([
    ('L1', '主卧', '2100W'), ('L2', '次卧', '1800W'),
    ('L3', '书房', '1800W'), ('L4', '客厅', '2400W')
]):
    x = 2 + i * 2
    ax1.plot([5, x], [8.2, 7.5], 'k-', lw=1.5)
    # Breaker
    r = FancyBboxPatch((x-0.6, 6.8), 1.2, 0.7, boxstyle='round', fill=False, edgecolor='black')
    ax1.add_patch(r)
    ax1.text(x, 7.15, f'{label}', ha='center', fontsize=8, fontweight='bold')
    # Wire
    ax1.plot([x, x], [6.8, 5.5], 'k-', lw=1)
    # Socket symbol
    ax1.plot([x-0.3, x+0.3], [5.2, 5.2], 'k-', lw=3)
    ax1.plot([x, x], [4.9, 5.5], 'k-', lw=1)
    ax1.plot([x-0.3, x+0.3], [4.9, 4.9], 'k-', lw=3)
    ax1.text(x, 4.5, f'{room}空调\n16A插座\n{power}', ha='center', fontsize=8)

    # Wire gauge
    ax1.text(x, 6.0, 'BV-4mm²×3', ha='center', fontsize=6, color='blue')

# Right: L5-L8 high power circuits
ax2.set_title('L5-L9 大功率回路', fontsize=12, fontweight='bold')
ax2.text(5, 9.5, '配电箱引出', ha='center', fontsize=9)
ax2.plot([5,5], [9, 8.5], 'k-', lw=2)
for i, (label, room, power, wire) in enumerate([
    ('L5', '电动车', '350W', 'BV-1.5mm²×3'),
    ('L6', '浴霸', '1000W', 'BV-2.5mm²×3'),
    ('L7', '吹风机', '1000W', 'BV-2.5mm²×3'),
    ('L8', '电磁炉+水壶', '3500W', 'BV-4mm²×3'),
    ('L9', '微波炉', '800W', 'BV-2.5mm²×3'),
]):
    x = 1.5 + i * 1.7
    ax2.plot([5, x], [8.2, 7.5], 'k-', lw=1.5)
    r = FancyBboxPatch((x-0.5, 6.8), 1.0, 0.7, boxstyle='round', fill=False, edgecolor='black')
    ax2.add_patch(r)
    ax2.text(x, 7.15, f'{label}', ha='center', fontsize=8, fontweight='bold')
    ax2.plot([x, x], [6.8, 5.5], 'k-', lw=1)
    ax2.plot([x-0.3, x+0.3], [5.2, 5.2], 'k-', lw=3)
    ax2.plot([x, x], [4.9, 5.5], 'k-', lw=1)
    ax2.plot([x-0.3, x+0.3], [4.9, 4.9], 'k-', lw=3)
    ax2.text(x, 4.5, f'{room}\n{power}', ha='center', fontsize=7)
    ax2.text(x, 6.0, wire, ha='center', fontsize=6, color='blue')

fig.suptitle('图4-2 大功率用电器及插座电气回路图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig4_2_hp_circuits.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('3. Fig 4-2 done')

# =================================================================
# Figure 4-3: 卫生间浴霸回路
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(8, 6))
ax.set_xlim(0, 10)
ax.set_ylim(0, 10)
ax.axis('off')

# Power source
ax.text(5, 9.5, '配电箱 L6 回路', ha='center', fontsize=10, fontweight='bold')
ax.plot([5, 5], [9.3, 8.5], 'k-', lw=2)

# Breaker
r = FancyBboxPatch((3.5, 8.0), 3, 0.8, boxstyle='round', fill=True, facecolor='lightcoral', edgecolor='black')
ax.add_patch(r)
ax.text(5, 8.4, '10A 空开 + 漏电保护器', ha='center', fontsize=9)

# Wire to junction box
ax.plot([5, 5], [8.0, 6.5], 'k-', lw=1.5)
ax.text(5.3, 7.3, 'BV-2.5mm²×3', fontsize=7, color='blue', rotation=90, va='center')

# Junction box
circle = Circle((5, 6.0), 0.3, fill=True, facecolor='lightgray', edgecolor='black')
ax.add_patch(circle)
ax.text(5, 6.0, 'J', ha='center', va='center', fontsize=8, fontweight='bold')

# Split to bath heater and light
# Bath heater
ax.plot([5, 3], [6.0, 4.5], 'k-', lw=1.5)
r2 = FancyBboxPatch((1.5, 3.8), 3, 1.0, boxstyle='round', fill=True, facecolor='orange', edgecolor='black', alpha=0.5)
ax.add_patch(r2)
ax.text(3, 4.3, '浴霸 1000W', ha='center', fontsize=10, fontweight='bold')
# Switch
ax.plot([3, 3], [3.8, 3.0], 'k--', lw=1)
r3 = Rectangle((2.4, 2.5), 1.2, 0.5, fill=True, facecolor='white', edgecolor='black')
ax.add_patch(r3)
ax.text(3, 2.75, '开关 1.4m', ha='center', fontsize=7)
ax.plot([3, 3], [2.5, 2.2], 'k-', lw=1)
ax.text(3, 1.8, '浴霸接线端\n(L/N/PE/灯/风扇)', ha='center', fontsize=8)

# Light
ax.plot([5, 7], [6.0, 4.5], 'k-', lw=1.5)
circle2 = Circle((7, 4.0), 0.4, fill=True, facecolor='yellow', edgecolor='black')
ax.add_patch(circle2)
ax.text(7, 4.0, '灯', ha='center', fontsize=7)
ax.text(7, 3.3, '卫生间照明\n防潮吸顶灯', ha='center', fontsize=8)

# Safety note
ax.text(5, 1.0, '⚡ 潮湿环境必须安装漏电保护器！', ha='center', fontsize=9, color='red', fontweight='bold')

ax.set_title('图4-3 卫生间浴霸电气回路接线图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig4_3_bath.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('4. Fig 4-3 done')

# =================================================================
# Figure 4-4: 主卧照明回路图
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(10, 7))
ax.set_xlim(0, 12)
ax.set_ylim(0, 10)
ax.axis('off')

# Power source
ax.text(6, 9.5, '配电箱 L11 回路（主次卧+书房照明及插座）', ha='center', fontsize=10, fontweight='bold')
ax.plot([6, 6], [9.3, 8.5], 'k-', lw=2)

# Breaker
r1 = FancyBboxPatch((4, 8.0), 4, 0.7, boxstyle='round', fill=True, facecolor='lightblue', edgecolor='black')
ax.add_patch(r1)
ax.text(6, 8.35, '16A 空开 (主卧段)', ha='center', fontsize=9)
ax.text(6, 7.5, 'BV-2.5mm²×3', fontsize=7, color='blue')

# Split into 3 branches
# 1. Ceiling light
ax.plot([6, 2], [7.2, 5.5], 'k-', lw=1.5)
ax.plot([2, 2], [5.5, 4.2], 'k-', lw=1)  # Switch wire
sw = Rectangle((1.5, 3.7), 1.0, 0.5, fill=True, facecolor='white', edgecolor='black')
ax.add_patch(sw)
ax.text(2, 3.95, '开关 1.4m', ha='center', fontsize=7)
ax.plot([2, 2], [3.7, 3.2], 'k-', lw=1)
circle1 = Circle((2, 2.7), 0.4, fill=True, facecolor='yellow', edgecolor='black')
ax.add_patch(circle1)
ax.text(2, 2.7, '灯', ha='center', fontsize=7)
ax.text(2, 2.2, '吸顶灯 9W', ha='center', fontsize=8)

# 2. Desk lamp
ax.plot([6, 6], [7.2, 5.0], 'k-', lw=1.5)
sw2 = Rectangle((5.5, 4.5), 1.0, 0.5, fill=True, facecolor='white', edgecolor='black')
ax.add_patch(sw2)
ax.text(6, 4.75, '开关', ha='center', fontsize=7)
ax.plot([6, 6], [4.5, 4.0], 'k-', lw=1)
rect = FancyBboxPatch((5, 3.0), 2, 1, boxstyle='round', fill=True, facecolor='lightyellow', edgecolor='black')
ax.add_patch(rect)
ax.text(6, 3.5, '书桌台灯 7W', ha='center', fontsize=9)

# 3. Bedside + TV outlet
ax.plot([6, 10], [7.2, 5.5], 'k-', lw=1.5)
ax.plot([10, 10], [5.5, 4.2], 'k-', lw=1)
ax.plot([9.7, 10.3], [4.2, 4.2], 'k-', lw=3)
ax.plot([10, 10], [4.2, 3.9], 'k-', lw=1)
ax.plot([9.7, 10.3], [3.9, 3.9], 'k-', lw=3)
ax.text(10, 3.5, '床头插座 0.7m\n(2个 10A五孔)', ha='center', fontsize=8, color='gray')

ax.plot([10, 10], [3.0, 2.0], 'k-', lw=1)
ax.plot([9.7, 10.3], [2.0, 2.0], 'k-', lw=3)
ax.text(10, 1.7, 'TV插座 0.65m', ha='center', fontsize=8, color='gray')

# Annotations
ax.text(0.5, 8.5, '火线 L (红)', fontsize=7, color='red')
ax.text(0.5, 8.0, '零线 N (蓝)', fontsize=7, color='blue')
ax.text(0.5, 7.5, '地线 PE (黄绿)', fontsize=7, color='green')

ax.set_title('图4-4 主卧小功率电器及照明电气接线回路图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig4_4_bedroom.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('5. Fig 4-4 done')

# =================================================================
# Figure 6-1 & 6-2: 灯具安装位置 + 照明布线 (combined floor plan view)
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(14, 10))
draw_floor_base(ax, show_rooms=True)

# Draw light fixtures with installation info
light_install = [
    (0.9, 6.5, '吸顶', '5W', '节能灯'),        # 1 corridor
    (3.2, 6.5, '吸顶', '9W', '节能灯'),         # 2 master BR center
    (3.0, 6.0, '台灯', '7W', 'LED'),             # 3 master desk
    (3.0, 6.8, '壁灯', '5W', 'LED'),             # 4 master bedside
    (5.4, 6.5, '吸顶', '7W', '节能灯'),          # 5 2nd BR center
    (5.4, 6.0, '台灯', '7W', 'LED'),              # 6 2nd BR desk
    (1.6, 3.2, '吸顶', '7W', '节能灯'),          # 7 study center
    (1.6, 2.7, '台灯', '7W', 'LED'),              # 8 study desk
    (2.7, 5.8, '防潮吸顶', '18W', '白炽灯'),     # 9 kitchen
    (2.7, 6.5, '镜前灯', '5W', 'LED'),            # 10 bath mirror
    (2.7, 5.8, '防潮吸顶', '5W', '节能灯'),       # 11 bath center
    (5.0, 3.0, '筒灯', '7W', 'LED'),              # 12 living decor
    (6.5, 2.5, '筒灯', '7W', 'LED'),              # 13 living decor
    (5.5, 2.5, '吸顶', '14W', '节能灯'),          # 14 living center
    (7.0, 2.5, '筒灯', '7W', 'LED'),              # 15 living decor
    (4.0, 2.5, '筒灯', '7W', 'LED'),              # 16 living decor
    (5.2, 0.75, '吸顶', '5W', '节能灯'),          # 17 balcony
]

for x, y, mtype, watt, lamp in light_install:
    color = 'orange' if '节能' in lamp else ('yellow' if 'LED' in lamp else 'white')
    ax.plot(x, y, 'o', color=color, markersize=8, markeredgecolor='black', markeredgewidth=1)
    ax.text(x, y-0.15, f'{watt}', ha='center', fontsize=5, color='gray')

# Draw wiring routes (simplified)
# L11: living+balcony+aisle
ax.plot([4.0, 5.0, 5.5, 6.5, 7.0, 5.2], [2.5, 3.0, 2.5, 2.5, 2.5, 0.75], 'r--', lw=0.5, alpha=0.5)
# L10: kitchen
ax.plot([1.6, 2.7], [3.2, 5.8], 'b--', lw=0.5, alpha=0.5)
# bath
ax.plot([2.7, 2.7], [5.8, 6.5], 'b--', lw=0.5, alpha=0.5)
# master BR
ax.plot([3.2, 3.0, 3.0], [6.5, 6.0, 6.8], 'g--', lw=0.5, alpha=0.5)
# 2nd BR
ax.plot([5.4, 5.4], [6.5, 6.0], 'g--', lw=0.5, alpha=0.5)
# study
ax.plot([1.6, 1.6], [3.2, 2.7], 'g--', lw=0.5, alpha=0.5)

# Distribution box symbol
rect = Rectangle((8.8, 3.5), 0.8, 0.5, fill=True, facecolor='red', edgecolor='black', alpha=0.7)
ax.add_patch(rect)
ax.text(9.2, 3.75, '配电箱', ha='center', fontsize=7, fontweight='bold')

ax.set_title('图6-1/6-2 灯具安装位置平面图及照明布线示意图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig6_1_2_lights.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('6. Fig 6-1/6-2 done')

# =================================================================
# Figure 6-3: 电气设备安装位置
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(14, 10))
draw_floor_base(ax, show_rooms=True)

# Distribution box
ax.plot(9.0, 3.6, 's', color='red', markersize=15, markeredgecolor='black', markeredgewidth=1.5)
ax.text(9.0, 3.3, '配电箱\n1.8m', ha='center', fontsize=7, fontweight='bold')

# Weak current box
ax.plot(9.5, 2.5, 's', color='blue', markersize=12, markeredgecolor='black', markeredgewidth=1)
ax.text(9.5, 2.2, '弱电箱\n0.3m', ha='center', fontsize=7)

# Air conditioner positions
ac_positions = [
    (9.3, 6.8, '主卧空调\n挂机 1.8m'),
    (3.55+(7.2-3.55)/2, 7.0, '次卧空调\n挂机 1.8m'),
    (3.2, 4.2, '书房空调\n挂机 1.8m'),
    (9.5, 2.8, '客厅空调\n柜机 0.3m'),
]
for x, y, label in ac_positions:
    ax.plot(x, y, 'D', color='cyan', markersize=10, markeredgecolor='black', markeredgewidth=1)
    ax.text(x, y-0.3, label, ha='center', fontsize=7)

# Electric vehicle charger
ax.plot(5.2, 0.5, '^', color='green', markersize=12, markeredgecolor='black')
ax.text(5.2, 0.2, '电动车充电\n防水插座', ha='center', fontsize=7)

# Water heater / bath equipment
ax.plot(2.7, 5.5, 'D', color='orange', markersize=8)
ax.text(2.7, 5.2, '浴霸', ha='center', fontsize=7)

ax.set_title('图6-3 电气设备和器件安装位置示意图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig6_3_equipment.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('7. Fig 6-3 done')

# =================================================================
# Figure 6-4: 插座安装平面图
# =================================================================
fig, ax = plt.subplots(1, 1, figsize=(14, 10))
draw_floor_base(ax, show_rooms=True)

# Socket positions (type and height)
sockets = [
    # Kitchen
    (1.0, 5.8, '油烟机\n1.8m', '16A三孔'),
    (1.0, 5.3, '台面插座x3\n1.2m', '10A五孔'),
    (1.0, 5.0, '冰箱\n0.3m', '10A三孔'),
    # Bath
    (2.2, 6.5, '吹风机\n1.5m', '10A五孔防水'),
    (2.2, 5.8, '热水器\n1.8m', '16A三孔'),
    # Master BR
    (9.8, 7.0, '空调\n1.8m', '16A三孔'),
    (9.3, 6.5, '床头x2\n0.7m', '10A五孔'),
    (10.0, 5.8, 'TV\n0.65m', '10A五孔'),
    # 2nd BR
    (6.5, 7.0, '空调\n1.8m', '16A三孔'),
    (6.5, 6.5, '床头x2\n0.7m', '10A五孔'),
    # Study
    (1.6, 4.2, '空调\n1.8m', '16A三孔'),
    (1.6, 2.5, '书桌x3\n0.3m', '10A五孔'),
    # Living
    (9.5, 2.2, '空调柜机\n0.3m', '16A三孔'),
    (9.0, 3.0, 'TV背景墙\nx4 0.3m', '10A五孔'),
    (7.5, 2.0, '普通x2\n0.3m', '10A五孔'),
    # Balcony
    (5.2, 1.0, '洗衣机\n1.0m', '10A五孔防水'),
    (8.0, 1.0, '备用\n0.3m', '10A五孔'),
]

for x, y, label, stype in sockets:
    if '空调' in label or '热水器' in label:
        color = 'red'
        marker = 's'
    elif '防水' in stype:
        color = 'blue'
        marker = 'D'
    else:
        color = 'green'
        marker = 'o'
    ax.plot(x, y, marker, color=color, markersize=8, markeredgecolor='black', markeredgewidth=0.5)
    ax.text(x, y-0.2, label, ha='center', fontsize=5, color=color)

# Legend
for label, color, marker in [('空调/大功率(16A)', 'red', 's'), ('防水插座', 'blue', 'D'), ('普通插座(10A)', 'green', 'o')]:
    ax.scatter([], [], c=color, marker=marker, label=label, edgecolors='black', s=30)
ax.legend(loc='lower right', fontsize=7, title='插座类型')

ax.set_title('图6-4 插座安装平面图', fontsize=14, fontweight='bold')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig6_4_sockets.png'), dpi=DPI, bbox_inches='tight')
plt.close()
print('8. Fig 6-4 done')

print(f'\nALL 8 diagrams generated in: {OUT}')
print('Files:')
for f in sorted(os.listdir(OUT)):
    size = os.path.getsize(os.path.join(OUT, f)) / 1024
    print(f'  {f} ({size:.0f}KB)')
