import sys, os
sys.stdout.reconfigure(encoding='utf-8')
print("Starting...", flush=True)

import win32com.client

input_path = r'C:\Users\lb\Documents\xwechat_files\wxid_kntl8qm95eag22_6034\msg\file\2026-06\（4）-7设计（论文）专用纸(1).doc'
out_dir = r'C:\Users\lb\Documents\xwechat_files\wxid_kntl8qm95eag22_6034\msg\file\2026-06'
output_path = os.path.join(out_dir, '（4）-7设计（论文）专用纸_含目录.doc')

word = win32com.client.Dispatch('Word.Application')
word.Visible = False
print("Word started", flush=True)

try:
    doc = word.Documents.Open(input_path)
    print(f"Doc opened", flush=True)
except Exception as e:
    print(f"Open error: {e}", flush=True)
    word.Quit()
    sys.exit(1)

# TOC content
toc_title = "目  录"
toc_items = [
    "第一章 绪论",
    "  1.1 为什么要开设这门课",
    "  1.2 运动控制系统的历史与发展",
    "  1.3 为什么选择PWM直流调速系统",
    "第二章 直流调速系统的工程设计方法",
    "  2.1 工程设计方法的基本指导思想",
    "  2.2 常用的典型系统",
    "  2.3 双闭环直流调速系统",
    "第三章 计算机Simulink仿真与计算",
    "  3.1 调节器的设计参数计算",
    "    3.1.1 电流调节器设计",
    "    3.1.2 转速调节器设计",
    "  3.2 主电路模型的参数计算",
    "  3.3 Simulink仿真",
    "    3.3.1 仿真模型及其参数设置",
    "    3.3.2 仿真输出波形及其分析",
    "第四章 具体硬件电路图设计与器件选型",
    "  4.1 直流PWM放大器设计",
    "    4.1.1 脉冲频率发生器的设计",
    "    4.1.2 脉宽调制器的设计",
    "  4.2 主电路",
    "  4.3 调节器",
    "    4.3.1 电流调节器",
    "    4.3.2 转速调节器",
    "  4.4 反馈模块设计",
    "参考文献",
]

# Get the range at the very beginning
rng = doc.Range(0, 0)

# Insert title
rng.Text = toc_title + "\r\n\r\n"
rng.Font.Name = "黑体"
rng.Font.Size = 16
rng.Font.Bold = True

# Insert TOC items
for item in toc_items:
    end_rng = doc.Range(doc.Content.End - 1, doc.Content.End - 1)
    end_rng.Text = item + "\r\n"
    end_rng.Font.Name = "宋体"
    end_rng.Font.Size = 12

# Add page break
end_rng2 = doc.Range(doc.Content.End - 1, doc.Content.End - 1)
end_rng2.Text = "\r\n"
end_rng2.InsertBreak(7)  # wdPageBreak = 7

doc.SaveAs(output_path)
doc.Close()
word.Quit()
print(f"Saved to {output_path}", flush=True)
