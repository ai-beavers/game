import { Color3 } from "@babylonjs/core/Maths/math.color.js";

export const hex = (value: number) => Color3.FromInts(value >> 16, (value >> 8) & 255, value & 255);
