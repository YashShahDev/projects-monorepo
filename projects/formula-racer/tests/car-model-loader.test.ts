import { expect, test } from "bun:test";
import { assertGlb } from "../src/rendering/car-model-loader.ts";

const bytes = (text: string) => new Uint8Array(new TextEncoder().encode(text)).buffer;

test("accepts a binary glTF by its magic number", () => {
  expect(() => {
    assertGlb(bytes("glTF\u0002\u0000\u0000\u0000"), "car.glb");
  }).not.toThrow();
});

test("explains a Git LFS pointer instead of failing to parse it", () => {
  const pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:79e4\nsize 1753024\n";
  expect(() => {
    assertGlb(bytes(pointer), "/assets/cars/fr26.glb");
  }).toThrow("/assets/cars/fr26.glb is a Git LFS pointer, not the model; run git lfs pull");
});

test("rejects anything else, including an empty file", () => {
  expect(() => {
    assertGlb(bytes("<!doctype html>"), "car.glb");
  }).toThrow("car.glb is not a binary glTF (.glb) file");
  expect(() => {
    assertGlb(bytes(""), "car.glb");
  }).toThrow("car.glb is not a binary glTF (.glb) file");
});
