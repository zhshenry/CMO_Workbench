import { dialog, ipcMain, type BrowserWindow } from 'electron';
import { roomCommandSchema, roomPlanSchema } from '../shared/room-booking';
import { RoomBooking } from './room-booking';

export function registerRoomBookingIpc(directory: string, main: () => BrowserWindow | null) {
  const rooms = new RoomBooking(directory);
  const methods = {
    state: () => rooms.state(),
    connect: () => rooms.connect(),
    save: (input: unknown) => rooms.savePlan(roomPlanSchema.parse(input)),
    command: (input: unknown) => rooms.command(roomCommandSchema.parse(input)),
    chooseExecutable: async () => {
      const window = main(); if (!window) throw new Error('工作台主窗口已关闭。');
      const picked = await dialog.showOpenDialog(window, { title: '选择已安装的会议室组件', properties: ['openFile'], filters: [{ name: 'Windows 程序', extensions: ['exe'] }] });
      return picked.canceled || !picked.filePaths[0] ? rooms.state() : rooms.selectExecutable(picked.filePaths[0]);
    },
    chooseDirectory: async () => {
      const window = main(); if (!window) throw new Error('工作台主窗口已关闭。');
      const picked = await dialog.showOpenDialog(window, { title: '选择现有的会议室组件数据目录', properties: ['openDirectory'] });
      return picked.canceled || !picked.filePaths[0] ? rooms.state() : rooms.selectDirectory(picked.filePaths[0]);
    },
  };
  for (const [name, fn] of Object.entries(methods)) ipcMain.handle('room-booking:' + name, (event, input: unknown) => {
    const primary = main()?.webContents;
    if (!primary || event.sender !== primary || event.senderFrame !== primary.mainFrame) throw new Error('请在 CMO 主窗口使用会议室预约。');
    return fn(input);
  });
  const timer = setInterval(() => void rooms.recover().catch(() => {}), 60000);
  return () => clearInterval(timer);
}
