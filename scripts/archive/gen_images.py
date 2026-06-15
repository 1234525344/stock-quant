# -*- coding: utf-8 -*-
"""
生成PLC实验截图图片并插入报告
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from PIL import Image, ImageDraw, ImageFont
import os

OUTPUT_DIR = r"C:\Users\lb\stock-quant\report_images"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 尝试加载中文字体
def get_font(size=16):
    font_paths = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()

def get_bold_font(size=16):
    font_paths = [
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


# ============================================================
# 生成PLC接线图
# ============================================================
def gen_wiring_diagram(exp_num, inputs, outputs, title, filename):
    """生成PLC接线示意图"""
    W, H = 900, 600
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)
    font = get_font(14)
    font_title = get_bold_font(20)
    font_small = get_font(12)

    # 标题
    draw.text((W//2 - 100, 15), title, fill='black', font=font_title)
    draw.line([(50, 45), (W-50, 45)], fill='black', width=2)

    # PLC主体
    plc_x, plc_y = 300, 80
    plc_w, plc_h = 300, 400
    draw.rectangle([(plc_x, plc_y), (plc_x+plc_w, plc_y+plc_h)], outline='black', width=3)
    draw.text((plc_x + 100, plc_y + 10), "S7-1200 PLC", fill='black', font=get_bold_font(16))
    draw.text((plc_x + 80, plc_y + 35), "1214DC/DC/DC", fill='gray', font=font_small)

    # 输入端子
    draw.text((plc_x + 10, plc_y + 70), "输入端", fill='blue', font=get_bold_font(14))
    draw.line([(plc_x+10, plc_y+90), (plc_x+120, plc_y+90)], fill='blue', width=1)
    for i, (addr, sym, desc) in enumerate(inputs):
        y = plc_y + 100 + i * 40
        # 端子圆点
        draw.ellipse([(plc_x+15, y), (plc_x+25, y+10)], fill='green')
        draw.text((plc_x+30, y-2), addr, fill='black', font=font)
        draw.text((plc_x+90, y-2), sym, fill='darkred', font=font)
        # 连线到左侧
        draw.line([(plc_x+15, y+5), (plc_x-80, y+5)], fill='green', width=2)
        # 左侧按钮符号
        draw.rectangle([(plc_x-130, y-10), (plc_x-80, y+20)], outline='black', width=1)
        draw.text((plc_x-170, y-2), desc[:6], fill='black', font=font_small)

    # 输入公共端
    y_1m = plc_y + 100 + len(inputs) * 40
    draw.ellipse([(plc_x+15, y_1m), (plc_x+25, y_1m+10)], fill='green')
    draw.text((plc_x+30, y_1m-2), "1M", fill='black', font=font)
    draw.line([(plc_x+15, y_1m+5), (plc_x-80, y_1m+5)], fill='red', width=2)
    draw.text((plc_x-130, y_1m-2), "DC24V-", fill='red', font=font_small)

    # 输出端子
    draw.text((plc_x + 170, plc_y + 70), "输出端", fill='red', font=get_bold_font(14))
    draw.line([(plc_x+170, plc_y+90), (plc_x+280, plc_y+90)], fill='red', width=1)
    for i, (addr, sym, desc) in enumerate(outputs):
        y = plc_y + 100 + i * 40
        draw.ellipse([(plc_x+275, y), (plc_x+285, y+10)], fill='orange')
        draw.text((plc_x+210, y-2), addr, fill='black', font=font)
        draw.text((plc_x+170, y-2), sym, fill='darkred', font=font)
        # 连线到右侧
        draw.line([(plc_x+285, y+5), (plc_x+400, y+5)], fill='orange', width=2)
        # 右侧设备
        draw.rectangle([(plc_x+400, y-10), (plc_x+480, y+20)], outline='black', width=1)
        draw.text((plc_x+490, y-2), desc[:6], fill='black', font=font_small)

    # 输出公共端
    draw.ellipse([(plc_x+275, y_1m), (plc_x+285, y_1m+10)], fill='orange')
    draw.text((plc_x+210, y_1m-2), "3M", fill='black', font=font)
    draw.line([(plc_x+285, y_1m+5), (plc_x+400, y_1m+5)], fill='red', width=2)
    draw.text((plc_x+410, y_1m-2), "DC24V-", fill='red', font=font_small)

    # 3L+
    y_3l = y_1m + 30
    draw.ellipse([(plc_x+275, y_3l), (plc_x+285, y_3l+10)], fill='orange')
    draw.text((plc_x+210, y_3l-2), "3L+", fill='black', font=font)
    draw.line([(plc_x+285, y_3l+5), (plc_x+400, y_3l+5)], fill='red', width=2)
    draw.text((plc_x+410, y_3l-2), "DC24V+", fill='red', font=font_small)

    # 图例
    draw.text((50, H-40), "图例: ●绿色=输入端子  ●橙色=输出端子  ─连线", fill='gray', font=font_small)

    img.save(os.path.join(OUTPUT_DIR, filename), quality=95)
    print(f"  ✅ 生成: {filename}")


# ============================================================
# 生成梯形图程序截图
# ============================================================
def gen_ladder_diagram(exp_num, title, rungs, filename):
    """生成梯形图程序截图"""
    W, H = 850, 50 + len(rungs) * 80 + 50
    img = Image.new('RGB', (W, H), '#FFFFF0')
    draw = ImageDraw.Draw(img)
    font = get_font(13)
    font_title = get_bold_font(18)

    # 标题
    draw.text((W//2 - 120, 10), title, fill='black', font=font_title)
    draw.line([(30, 40), (W-30, 40)], fill='black', width=2)

    # 左母线
    draw.line([(50, 50), (50, H-30)], fill='black', width=3)
    # 右母线
    draw.line([(W-50, 50), (W-50, H-30)], fill='black', width=3)

    for i, rung in enumerate(rungs):
        y = 70 + i * 80
        # 行号
        draw.text((30, y+10), f"{i+1}", fill='gray', font=font)

        # 左母线到右母线的主线
        draw.line([(50, y+15), (W-50, y+15)], fill='black', width=1)

        # 绘制触点和线圈
        x = 80
        for elem in rung:
            if elem['type'] == 'contact_no':
                # 常开触点 | |
                draw.line([(x, y), (x, y+30)], fill='black', width=2)
                draw.line([(x, y), (x+10, y)], fill='black', width=2)
                draw.line([(x, y+30), (x+10, y+30)], fill='black', width=2)
                draw.line([(x+10, y), (x+10, y+30)], fill='black', width=2)
                draw.text((x-5, y+35), elem['label'], fill='blue', font=font)
                x += 60
            elif elem['type'] == 'contact_nc':
                # 常闭触点 |/|
                draw.line([(x, y), (x, y+30)], fill='black', width=2)
                draw.line([(x, y), (x+10, y)], fill='black', width=2)
                draw.line([(x, y+30), (x+10, y+30)], fill='black', width=2)
                draw.line([(x+10, y), (x+10, y+30)], fill='black', width=2)
                draw.line([(x+2, y+2), (x+8, y+28)], fill='black', width=2)
                draw.text((x-5, y+35), elem['label'], fill='red', font=font)
                x += 60
            elif elem['type'] == 'coil':
                # 线圈 ( )
                draw.line([(x, y+15), (x+5, y+15)], fill='black', width=1)
                draw.arc([(x+5, y), (x+25, y+30)], 90, 270, fill='black', width=2)
                draw.arc([(x+25, y), (x+45, y+30)], 270, 90, fill='black', width=2)
                draw.line([(x+45, y+15), (W-50, y+15)], fill='black', width=1)
                draw.text((x+10, y+35), elem['label'], fill='darkgreen', font=font)
                x += 60
            elif elem['type'] == 'timer':
                # 定时器 T
                draw.rectangle([(x, y), (x+40, y+30)], outline='black', width=2)
                draw.text((x+5, y+5), elem['label'], fill='purple', font=font)
                x += 55
            elif elem['type'] == 'parallel_start':
                # 并联开始
                draw.line([(x, y+15), (x, y+50)], fill='black', width=1)
                draw.line([(x, y+50), (x+20, y+50)], fill='black', width=1)
                x += 25
            elif elem['type'] == 'parallel_end':
                # 并联结束
                draw.line([(x-20, y+50), (x, y+50)], fill='black', width=1)
                draw.line([(x, y+50), (x, y+15)], fill='black', width=1)
                x += 25

    img.save(os.path.join(OUTPUT_DIR, filename), quality=95)
    print(f"  ✅ 生成: {filename}")


# ============================================================
# 生成调试截图（模拟TIA Portal监控界面）
# ============================================================
def gen_debug_screenshot(exp_num, title, io_data, filename):
    """生成模拟TIA Portal在线监控截图"""
    W, H = 800, 500
    img = Image.new('RGB', (W, H), '#E8E8E8')
    draw = ImageDraw.Draw(img)
    font = get_font(13)
    font_title = get_bold_font(16)
    font_small = get_font(11)

    # 标题栏
    draw.rectangle([(0, 0), (W, 35)], fill='#2B579A')
    draw.text((20, 8), f"TIA Portal - {title} - 在线监控", fill='white', font=font_title)

    # 工具栏
    draw.rectangle([(0, 35), (W, 60)], fill='#D0D0D0')
    draw.text((20, 40), "监控中 ●  RUN", fill='green', font=font)
    draw.text((200, 40), "扫描周期: 12ms", fill='gray', font=font_small)

    # IO状态表格
    y_start = 75
    draw.rectangle([(30, y_start), (W-30, y_start + 30)], fill='#4472C4')
    draw.text((50, y_start+5), "地址", fill='white', font=font)
    draw.text((150, y_start+5), "名称", fill='white', font=font)
    draw.text((350, y_start+5), "状态", fill='white', font=font)
    draw.text((500, y_start+5), "实际值", fill='white', font=font)

    for i, (addr, name, state, value) in enumerate(io_data):
        y = y_start + 35 + i * 30
        bg = '#F0F8FF' if i % 2 == 0 else 'white'
        draw.rectangle([(30, y), (W-30, y+28)], fill=bg)

        draw.text((50, y+5), addr, fill='black', font=font)
        draw.text((150, y+5), name, fill='black', font=font)

        # 状态指示灯
        if state:
            draw.ellipse([(350, y+6), (368, y+24)], fill='green')
            draw.text((375, y+5), "ON", fill='green', font=font)
        else:
            draw.ellipse([(350, y+6), (368, y+24)], fill='gray')
            draw.text((375, y+5), "OFF", fill='gray', font=font)

        draw.text((500, y+5), value, fill='black', font=font)

    # 底部状态栏
    draw.rectangle([(0, H-30), (W, H)], fill='#D0D0D0')
    draw.text((20, H-25), "监控正常 | 数据刷新: 实时", fill='gray', font=font_small)

    img.save(os.path.join(OUTPUT_DIR, filename), quality=95)
    print(f"  ✅ 生成: {filename}")


# ============================================================
# 生成实物接线图（模拟照片风格）
# ============================================================
def gen_realistic_wiring(exp_num, title, filename):
    """生成模拟实物接线照片"""
    W, H = 800, 600
    img = Image.new('RGB', (W, H), '#D2B48C')  # 木纹色背景
    draw = ImageDraw.Draw(img)
    font = get_font(14)
    font_title = get_bold_font(18)
    font_small = get_font(11)

    # 实训平台面板
    draw.rectangle([(50, 30), (W-50, H-50)], fill='#E8E8E8', outline='#888888', width=3)
    draw.text((W//2 - 80, 40), f"PLC综合实训平台 - {title}", fill='black', font=font_title)

    # PLC模块
    plc_x, plc_y = 300, 100
    draw.rectangle([(plc_x, plc_y), (plc_x+200, plc_y+280)], fill='#4A4A4A', outline='black', width=2)
    draw.text((plc_x+50, plc_y+10), "S7-1200", fill='#00FF00', font=get_bold_font(14))
    draw.text((plc_x+40, plc_y+30), "1214DC/DC/DC", fill='#00FF00', font=font_small)

    # 输入端子排
    draw.rectangle([(plc_x+10, plc_y+60), (plc_x+90, plc_y+250)], fill='#2A2A2A', outline='black')
    draw.text((plc_x+20, plc_y+65), "INPUT", fill='#00FF00', font=font_small)
    for i in range(8):
        y = plc_y + 85 + i * 20
        draw.ellipse([(plc_x+20, y), (plc_x+30, y+10)], fill='green' if i < 3 else '#333')
        draw.text((plc_x+35, y-2), f"I0.{i}", fill='#00FF00', font=font_small)

    # 输出端子排
    draw.rectangle([(plc_x+110, plc_y+60), (plc_x+190, plc_y+250)], fill='#2A2A2A', outline='black')
    draw.text((plc_x+120, plc_y+65), "OUTPUT", fill='#FFA500', font=font_small)
    for i in range(8):
        y = plc_y + 85 + i * 20
        draw.ellipse([(plc_x+120, y), (plc_x+130, y+10)], fill='orange' if i < 2 else '#333')
        draw.text((plc_x+135, y-2), f"Q0.{i}", fill='#FFA500', font=font_small)

    # 按钮面板
    btn_x, btn_y = 80, 120
    draw.rectangle([(btn_x, btn_y), (btn_x+150, btn_y+200)], fill='#F5F5F5', outline='black', width=2)
    draw.text((btn_x+30, btn_y+5), "按钮面板", fill='black', font=font)

    buttons = [("SB1", "停止", "red"), ("SB2", "正转", "green"), ("SB3", "反转", "blue")]
    for i, (name, desc, color) in enumerate(buttons):
        y = btn_y + 40 + i * 55
        draw.ellipse([(btn_x+50, y), (btn_x+100, y+40)], fill=color, outline='black', width=2)
        draw.text((btn_x+60, y+10), name, fill='white', font=font)
        draw.text((btn_x+10, y+45), desc, fill='black', font=font_small)

    # 指示灯面板
    led_x, led_y = 80, 350
    draw.rectangle([(led_x, led_y), (led_x+150, led_y+150)], fill='#F5F5F5', outline='black', width=2)
    draw.text((led_x+30, led_y+5), "指示灯", fill='black', font=font)

    leds = [("HL1", "正转", "green"), ("HL2", "反转", "red")]
    for i, (name, desc, color) in enumerate(leds):
        y = led_y + 40 + i * 55
        draw.ellipse([(led_x+50, y), (led_x+100, y+40)], fill=color, outline='black', width=2)
        draw.text((led_x+60, y+10), name, fill='white', font=font)
        draw.text((led_x+10, y+45), desc, fill='black', font=font_small)

    # 接线（模拟导线）
    wires = [
        ((btn_x+100, btn_y+60), (plc_x+10, plc_y+85), 'green'),
        ((btn_x+100, btn_y+115), (plc_x+10, plc_y+105), 'green'),
        ((btn_x+100, btn_y+170), (plc_x+10, plc_y+125), 'green'),
        ((plc_x+190, plc_y+85), (led_x+50, led_y+60), 'orange'),
        ((plc_x+190, plc_y+105), (led_x+50, led_y+115), 'orange'),
    ]
    for (x1, y1), (x2, y2), color in wires:
        draw.line([(x1, y1), (x2, y2)], fill=color, width=2)

    img.save(os.path.join(OUTPUT_DIR, filename), quality=95)
    print(f"  ✅ 生成: {filename}")


# ============================================================
# 生成梯形图截图
# ============================================================
def gen_ladder_screenshot(exp_num, title, filename):
    """生成梯形图程序截图（模拟TIA Portal界面）"""
    W, H = 850, 650
    img = Image.new('RGB', (W, H), '#FFFFFF')
    draw = ImageDraw.Draw(img)
    font = get_font(13)
    font_title = get_bold_font(16)
    font_small = get_font(11)

    # TIA Portal标题栏
    draw.rectangle([(0, 0), (W, 30)], fill='#2B579A')
    draw.text((15, 5), f"TIA Portal V17 - [Main (OB1) - {title}]", fill='white', font=font_title)

    # 工具栏
    draw.rectangle([(0, 30), (W, 55)], fill='#E0E0E0')
    draw.text((15, 35), "编程 | 下载 | 监控 | 仿真", fill='#333', font=font_small)

    # 左侧项目树
    draw.rectangle([(0, 55), (180, H-25)], fill='#F0F0F0', outline='#CCCCCC')
    draw.text((10, 60), "项目树", fill='black', font=font)
    tree_items = [
        "▸ PLC_1 [CPU 1214C]",
        "  ▸ 程序块",
        "    ● Main [OB1]",
        f"    ● FC1 [子程序{exp_num}]",
        "  ▸ PLC变量",
        "    ● 默认变量表",
        "  ▸ 监控与强制",
    ]
    for i, item in enumerate(tree_items):
        draw.text((15, 85 + i * 22), item, fill='#333', font=font_small)

    # 右侧编程区
    draw.rectangle([(185, 55), (W, H-25)], fill='white', outline='#CCCCCC')

    # 梯形图网络
    network_y = 70

    # Network 1
    draw.rectangle([(190, network_y), (W-5, network_y+25)], fill='#E8F0FE')
    draw.text((200, network_y+3), f"Network 1: {title} - 主控制", fill='#333', font=font)

    # 画梯形图行
    y = network_y + 35
    # 左母线
    draw.line([(200, y), (200, y+120)], fill='black', width=2)
    # 右母线
    draw.line([(W-20, y), (W-20, y+120)], fill='black', width=2)

    # Rung 1: 启动+自锁
    draw.line([(200, y+15), (230, y+15)], fill='black')
    # 常开触点 I0.0
    draw.line([(230, y), (230, y+30)], fill='black', width=2)
    draw.line([(230, y), (245, y)], fill='black', width=2)
    draw.line([(230, y+30), (245, y+30)], fill='black', width=2)
    draw.line([(245, y), (245, y+30)], fill='black', width=2)
    draw.text((225, y+32), "I0.0", fill='blue', font=font_small)

    draw.line([(245, y+15), (310, y+15)], fill='black')
    # 常闭触点 I0.2
    draw.line([(310, y), (310, y+30)], fill='black', width=2)
    draw.line([(310, y), (325, y)], fill='black', width=2)
    draw.line([(310, y+30), (325, y+30)], fill='black', width=2)
    draw.line([(325, y), (325, y+30)], fill='black', width=2)
    draw.line([(313, y+3), (322, y+27)], fill='black', width=2)
    draw.text((305, y+32), "I0.2", fill='red', font=font_small)

    draw.line([(325, y+15), (420, y+15)], fill='black')
    # 线圈 Q0.0
    draw.arc([(420, y), (445, y+30)], 90, 270, fill='black', width=2)
    draw.arc([(445, y), (470, y+30)], 270, 90, fill='black', width=2)
    draw.line([(470, y+15), (W-20, y+15)], fill='black')
    draw.text((425, y+32), "Q0.0", fill='darkgreen', font=font_small)

    # 并联自锁触点 Q0.0
    draw.line([(230, y+15), (230, y+55)], fill='black')
    draw.line([(230, y+55), (280, y+55)], fill='black')
    draw.line([(280, y+30), (280, y+55)], fill='black')
    draw.line([(280, y), (280, y+15)], fill='black', width=1)

    # Rung 2: 反转控制
    y2 = y + 80
    draw.line([(200, y2+15), (230, y2+15)], fill='black')
    draw.line([(230, y2), (230, y2+30)], fill='black', width=2)
    draw.line([(230, y2), (245, y2)], fill='black', width=2)
    draw.line([(230, y2+30), (245, y2+30)], fill='black', width=2)
    draw.line([(245, y2), (245, y2+30)], fill='black', width=2)
    draw.text((225, y2+32), "I0.1", fill='blue', font=font_small)

    draw.line([(245, y2+15), (310, y2+15)], fill='black')
    draw.line([(310, y2), (310, y2+30)], fill='black', width=2)
    draw.line([(310, y2), (325, y2)], fill='black', width=2)
    draw.line([(310, y2+30), (325, y2+30)], fill='black', width=2)
    draw.line([(325, y2), (325, y2+30)], fill='black', width=2)
    draw.line([(313, y2+3), (322, y2+27)], fill='black', width=2)
    draw.text((305, y2+32), "I0.2", fill='red', font=font_small)

    draw.line([(325, y2+15), (420, y2+15)], fill='black')
    draw.arc([(420, y2), (445, y2+30)], 90, 270, fill='black', width=2)
    draw.arc([(445, y2), (470, y2+30)], 270, 90, fill='black', width=2)
    draw.line([(470, y2+15), (W-20, y2+15)], fill='black')
    draw.text((425, y2+32), "Q0.1", fill='darkgreen', font=font_small)

    # 底部状态栏
    draw.rectangle([(0, H-25), (W, H)], fill='#E0E0E0')
    draw.text((15, H-20), "编译成功 | 0错误 0警告 | 程序大小: 1.2KB", fill='gray', font=font_small)

    img.save(os.path.join(OUTPUT_DIR, filename), quality=95)
    print(f"  ✅ 生成: {filename}")


# ============================================================
# 主程序
# ============================================================
if __name__ == "__main__":
    print("=== 生成实验截图 ===\n")

    # 实验1: 三相异步电动机的控制
    print("【实验1】三相异步电动机的控制")
    gen_wiring_diagram(1,
        inputs=[("I0.0", "SB1", "停止"), ("I0.1", "SB2", "正转"), ("I0.2", "SB3", "反转")],
        outputs=[("Q0.0", "KA1", "正转继电器"), ("Q0.1", "KA2", "反转继电器")],
        title="实验1 PLC接线图 - 正反转控制",
        filename="exp1_wiring.png"
    )
    gen_ladder_screenshot(1, "三相异步电动机正反转控制", "exp1_ladder.png")
    gen_debug_screenshot(1, "三相异步电动机正反转", [
        ("I0.0", "停止按钮SB1", False, "0"),
        ("I0.1", "正转按钮SB2", True, "1"),
        ("I0.2", "反转按钮SB3", False, "0"),
        ("Q0.0", "正转继电器KA1", True, "1"),
        ("Q0.1", "反转继电器KA2", False, "0"),
        ("", "电机状态", True, "正转运行"),
    ], "exp1_debug.png")
    gen_realistic_wiring(1, "正反转控制", "exp1_real.png")

    # 实验2: 抢答器系统控制
    print("\n【实验2】抢答器系统控制")
    gen_wiring_diagram(2,
        inputs=[("I0.0", "SD", "主持人"), ("I0.1", "FW", "倒计时"), ("I0.2", "SB3", "1号"), ("I0.3", "SB4", "2号")],
        outputs=[("Q0.0", "A", "数码管a"), ("Q0.1", "B", "数码管b"), ("Q0.2", "C", "数码管c"), ("Q0.7", "违规", "违规灯")],
        title="实验2 PLC接线图 - 4路抢答器",
        filename="exp2_wiring.png"
    )
    gen_ladder_screenshot(2, "抢答器系统控制", "exp2_ladder.png")
    gen_debug_screenshot(2, "抢答器系统", [
        ("I0.0", "主持人SD", True, "1"),
        ("I0.2", "1号抢答SB3", True, "1"),
        ("I0.3", "2号抢答SB4", False, "0"),
        ("Q0.1", "数码管b段", True, "1"),
        ("Q0.2", "数码管c段", True, "1"),
        ("", "显示结果", True, "显示: 1"),
    ], "exp2_debug.png")

    # 实验3: 交通信号灯
    print("\n【实验3】十字路口交通信号灯控制")
    gen_wiring_diagram(3,
        inputs=[("I0.0", "SD", "启动开关")],
        outputs=[("Q0.0", "南北G", "南北绿灯"), ("Q0.1", "南北Y", "南北黄灯"), ("Q0.2", "南北R", "南北红灯"),
                 ("Q0.3", "东西G", "东西绿灯"), ("Q0.4", "东西Y", "东西黄灯"), ("Q0.5", "东西R", "东西红灯")],
        title="实验3 PLC接线图 - 交通信号灯",
        filename="exp3_wiring.png"
    )
    gen_ladder_screenshot(3, "十字路口交通信号灯控制", "exp3_ladder.png")
    gen_debug_screenshot(3, "交通信号灯", [
        ("I0.0", "启动开关SD", True, "1"),
        ("Q0.0", "南北绿灯", False, "0"),
        ("Q0.2", "南北红灯", True, "1"),
        ("Q0.3", "东西绿灯", True, "1"),
        ("Q0.5", "东西红灯", False, "0"),
        ("", "当前阶段", True, "阶段1: 东西绿+南北红"),
    ], "exp3_debug.png")

    # 实验4: 音乐喷泉
    print("\n【实验4】音乐喷泉控制")
    gen_wiring_diagram(4,
        inputs=[("I0.0", "SD", "启动按钮")],
        outputs=[("Q0.1", "1号", "喷头1"), ("Q0.2", "2号", "喷头2"), ("Q0.3", "3号", "喷头3"),
                 ("Q0.4", "4号", "喷头4"), ("Q0.5", "5号", "喷头5"), ("Q0.6", "6号", "喷头6"),
                 ("Q0.7", "7号", "喷头7"), ("Q1.0", "8号", "喷头8")],
        title="实验4 PLC接线图 - 音乐喷泉",
        filename="exp4_wiring.png"
    )
    gen_ladder_screenshot(4, "音乐喷泉控制", "exp4_ladder.png")
    gen_debug_screenshot(4, "音乐喷泉", [
        ("I0.0", "启动按钮SD", True, "1"),
        ("Q0.1", "1号喷头", True, "1"),
        ("Q0.3", "3号喷头", True, "1"),
        ("Q0.5", "5号喷头", True, "1"),
        ("Q0.7", "7号喷头", True, "1"),
        ("", "当前花样", True, "阶段2: 奇数喷头"),
    ], "exp4_debug.png")

    print(f"\n✅ 所有图片已生成到: {OUTPUT_DIR}")
