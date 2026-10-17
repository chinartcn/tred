export class Bar {
  // @TRED_START: Bar#x | fp=22222222
  x(): void {}
  // @TRED_START: Bar#y | fp=33333333
  y(): void {}
  // @TRED_END: Bar#zzz
}
