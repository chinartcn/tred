// @ts-nocheck
// 演示文件：故意引用未定义函数，用于展示 tred diff 效果
export class GraphEngine {
  // @TRED_START: GraphEngine#loadUnlocked | fp=b2c3d4e5
  loadUnlocked(): void {
    console.log('v2');
    doExtra();
  }
  // @TRED_END: GraphEngine#loadUnlocked
  // @TRED_START: GraphEngine#save | fp=a1b2c3d4
  save(): void {
    console.log('save v1');
  }
  // @TRED_END: GraphEngine#save
}
