/// <reference lib="webworker" />

import {
  createSummerPhysicsState,
  serializeSummerPhysics,
  stepSummerPhysics,
  SummerPhysicsConfig,
  SummerPhysicsPublicState,
} from './SeasonalEffectsSummerPhysics';

type TickMessage = {
  type: 'tick';
  now: number;
  dt: number;
  width: number;
  height: number;
};

type ResetMessage = {
  type: 'reset';
  startTime: number;
  config: SummerPhysicsConfig;
};

type ConfigMessage = {
  type: 'config';
  config: SummerPhysicsConfig;
};

type SummerPhysicsWorkerMessage = TickMessage | ResetMessage | ConfigMessage;

let physicsState = createSummerPhysicsState(0);
let config: SummerPhysicsConfig | null = null;

function postState(state: SummerPhysicsPublicState) {
  const { dropsData, trailsData } = serializeSummerPhysics(state.drops, state.trails);
  postMessage(
    {
      type: 'state',
      dropsData,
      trailsData,
      flash: state.flash,
    },
    [dropsData.buffer, trailsData.buffer],
  );
}

self.onmessage = (event: MessageEvent<SummerPhysicsWorkerMessage>) => {
  const message = event.data;

  if (message.type === 'reset') {
    physicsState = createSummerPhysicsState(message.startTime);
    config = message.config;
    postState({
      drops: physicsState.drops,
      trails: physicsState.trails,
      flash: physicsState.flash,
    });
    return;
  }

  if (message.type === 'config') {
    config = message.config;
    return;
  }

  if (message.type === 'tick' && config) {
    const next = stepSummerPhysics(physicsState, {
      now: message.now,
      dt: message.dt,
      width: message.width,
      height: message.height,
      config,
    });
    postState(next);
  }
};

export {};

