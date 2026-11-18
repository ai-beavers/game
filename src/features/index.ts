// Every feature the game runs with, in the order they are created. A feature lives in its own folder and
// exports `create` (see src/game.ts).
import type { CreateFeature } from "../game.ts";
import { create as audio } from "./audio/index.ts";
import { create as build } from "./build/index.ts";
import { create as controls } from "./controls/index.ts";
import { create as fx } from "./fx/index.ts";
import { create as hud } from "./hud/index.ts";
import { create as lantern } from "./lantern/index.ts";
import { create as life } from "./life/index.ts";
import { create as net } from "./net/index.ts";
import { create as post } from "./post/index.ts";
import { create as shop } from "./shop/index.ts";
import { create as sky } from "./sky/index.ts";
import { create as tour } from "./tour/index.ts";

export const FEATURES: CreateFeature[] = [controls, sky, lantern, post, build, shop, fx, life, net, audio, hud, tour];
