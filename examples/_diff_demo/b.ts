// @ts-nocheck
// 演示文件：故意引用未定义函数，用于展示 tred diff 效果
export class GraphEngine {
  // @TRED_START: GraphEngine#loadUnlocked | fp=b1b2c3d4
  loadUnlocked(): void {
    console.log('v2 body');
    doExtraWork();
  }
  // @TRED_END: GraphEngine#loadUnlocked
}
