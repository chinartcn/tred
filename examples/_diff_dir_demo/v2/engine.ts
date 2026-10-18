// @ts-nocheck
// 演示文件：故意引用未定义函数，用于展示 tred diff 效果
export class GraphEngine {
  loadUnlocked(): void {
    console.log('v2');
    doExtra();
  }
  save(): void {
    console.log('save v1');
  }
}
