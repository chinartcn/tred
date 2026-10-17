export class Foo {
  // @TRED_START: Foo#a | fp=11111111
  a(): void {}
  // @TRED_END: Foo#a
  // @TRED_START: Foo#b | fp=22222222
  b(): void {}
}
// @TRED_END: Foo#never-existed
