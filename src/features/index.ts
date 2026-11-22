// Every feature the game runs with, in the order they are created. A feature lives in its own folder and
// exports `create` (see src/game.ts).
import type { CreateFeature } from "../game.ts";
import { create as audio } from "./audio/index.ts";
import { create as bakery } from "./bakery/index.ts";
import { create as bear } from "./bear/index.ts";
import { create as riverKit } from "./river-kit/index.ts";
import { create as canoe } from "./canoe/index.ts";
import { create as build } from "./build/index.ts";
import { create as controls } from "./controls/index.ts";
import { create as debug } from "./debug/index.ts";
import { create as droppings } from "./droppings/index.ts";
import { create as flag } from "./flag/index.ts";
import { create as fx } from "./fx/index.ts";
import { create as hud } from "./hud/index.ts";
import { create as lantern } from "./lantern/index.ts";
import { create as mrsBeaver } from "./mrs-beaver/index.ts";
import { create as mushrooms } from "./mushrooms/index.ts";
import { create as life } from "./life/index.ts";
import { create as oldBeaver } from "./old-beaver/index.ts";
import { create as net } from "./net/index.ts";
import { create as race } from "./race/index.ts";
import { create as post } from "./post/index.ts";
import { create as shop } from "./shop/index.ts";
import { create as sky } from "./sky/index.ts";
import { create as stare } from "./stare/index.ts";
import { create as tour } from "./tour/index.ts";
import { create as trade } from "./trade/index.ts";
import { create as workbench } from "./workbench/index.ts";

export const FEATURES: CreateFeature[] = [controls, sky, lantern, stare, post, build, trade, bakery, workbench, shop, canoe, race, flag, droppings, mrsBeaver, mushrooms, oldBeaver, fx, life, bear, riverKit, net, audio, hud, debug, tour];
