export class Foo {
  // @TRED_START: Foo#a | fp=11111111
  a(): void {}
  // @TRED_END: Foo#a
  // @TRED_END: Foo#never-existed
  b(): void {}
}
