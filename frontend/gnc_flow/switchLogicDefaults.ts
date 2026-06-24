import type { SwitchLogicTables } from './types';

export const defaultSwitchLogic: SwitchLogicTables = {
  autonomous: [
    { id: 'auto-a1', code: 'A1', description: '30s内三轴角速度幅值均小于1.5°/s' },
    { id: 'auto-a2', code: 'A2', description: '20s帆板展开时间' },
    { id: 'auto-a3', code: 'A3', description: '50s内三轴角速度幅值均小于0.5°/s' },
    { id: 'auto-a4', code: 'A4', description: '50s内太阳角小于10°' },
    { id: 'auto-a5', code: 'A5', description: '欧拉角偏差小于26角分且指令目标为常规指向' },
    { id: 'auto-a6', code: 'A6', description: '欧拉角偏差小于26角分且指令目标为高稳定度指向' },
    { id: 'auto-a7', code: 'A7', description: '到达轨控数据包指定轨控开始时刻，并且姿态满足对地定向' },
    { id: 'auto-a8', code: 'A8', description: '轨控时间到达或轨控姿态故障，退出轨控模式' },
    { id: 'auto-a9', code: 'A9', description: '到达轨控数据包指定轨控开始时刻，但姿态不满足对地定向' },
    { id: 'auto-a10', code: 'A10', description: '50s内三轴角速度幅值均小于0.1°/s' },
    { id: 'auto-a11', code: 'A11', description: '50s内太阳角小于35°' },
    { id: 'auto-a12', code: 'A12', description: '30分钟入轨太阳捕获未完成' },
    { id: 'auto-a13', code: 'A13', description: '姿态偏差大、定姿故障、动量轮故障' },
    { id: 'auto-a14', code: 'A14', description: '轨控期间姿态偏差偏大、定姿故障、动量轮故障' },
  ],
  command: [
    { id: 'cmd-c1', code: 'C1', description: '指令退出入轨模式，进入任务对日定向' },
    { id: 'cmd-c2-c5-c6', code: 'C2、C5、C6', description: '指令进入任务指向，且姿态角偏差较大（26角分）' },
    { id: 'cmd-c3', code: 'C3', description: '指令进入高稳定度指向，且姿态角偏差较小' },
    { id: 'cmd-c4', code: 'C4', description: '指令进入常规指向，且姿态角偏差较小' },
    { id: 'cmd-c7', code: 'C7', description: '指令进入轨控模式' },
    { id: 'cmd-c8', code: 'C8', description: '指令退出安全模式，进入任务对日定向' },
  ],
  note: '地面指令可强制切换任意两种工作模式，包括星上自主切换模式。',
};
