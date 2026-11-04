import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from 'react-native-reanimated';
import { runHaptic } from '@/utils/haptics';
import {
  CUT_CARD_STAGGER_MS,
  CUT_CARD_TRAVEL_MS,
  CUT_WINNER_PAUSE_MS,
} from './canvas/animationTiming';
import type { TableModel } from './canvas/tableModel';
import type { ServerBid } from '@/types/game';
import { getTableHapticEvents } from './hapticTransitions';
import { play } from './sounds';
import {
  TURN_REMINDER_MS,
  bidSound,
  yourPlayTurnStarted,
  yourTurnKey,
} from '@/features/game/sounds';
export { playSelectionHaptic } from '@/utils/haptics';

export function playActionHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  );
}

/** A wrong answer, such as a seat password: a light buzz. */
export function playWrongHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  );
}

function playDealPacketHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)
  );
}

function playTrickHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  );
}

/** A trick holding a five, seen from no seat: the heaviest tap the table makes. */
export function playBigTrickHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
  );
}

/** Our side took a five: the happy one. Sounds hook in here later. */
export function playOurPidroHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
}

/** They took a five: the sad one. Sounds hook in here later. */
export function playTheirPidroHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  );
}

/** "Your turn": a two-beat tap, unlike any card or trick, so it reads without looking. */
function playTurnHaptic() {
  runHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** The table's haptics, and the sounds that share their moments: your turn, the bids. */
export function useTableHaptics(model: TableModel, bids?: ServerBid[]) {
  const reducedMotion = useReducedMotion();
  const previousModel = useRef<TableModel | null>(null);
  const previousBids = useRef(bids);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const schedule = (effect: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        effect();
      }, delay);
      timers.current.add(timer);
    };

    if (yourPlayTurnStarted(previousModel.current, model)) play('turn');
    const events = getTableHapticEvents(previousModel.current, model);
    for (const event of events) {
      if (event === 'your_turn') playTurnHaptic();
      if (event === 'deal_packet') playDealPacketHaptic();
      if (event === 'hand_shuffle') {
        playDealPacketHaptic();
        if (!reducedMotion) {
          schedule(playDealPacketHaptic, 80);
          schedule(playDealPacketHaptic, 170);
        }
      }
      if (event === 'dealer_cut_sequence') {
        const cutCount = Object.keys(model.dealerCuts).length;
        if (reducedMotion) {
          playActionHaptic();
        } else {
          for (let index = 0; index < cutCount; index += 1) {
            schedule(playDealPacketHaptic, index * CUT_CARD_STAGGER_MS + CUT_CARD_TRAVEL_MS);
          }
          if (model.dealerRelative && model.dealerCuts[model.dealerRelative]) {
            schedule(
              playTrickHaptic,
              Math.max(0, cutCount - 1) * CUT_CARD_STAGGER_MS +
                CUT_CARD_TRAVEL_MS +
                CUT_WINNER_PAUSE_MS
            );
          }
        }
      }
    }
    previousModel.current = model;
  }, [model, reducedMotion]);

  useEffect(() => {
    const sound = bidSound(previousBids.current, bids);
    previousBids.current = bids;
    if (sound) play(sound);
  }, [bids]);

  const turnKey = yourTurnKey(model);
  useEffect(() => {
    if (!turnKey) return;
    const timer = setInterval(() => play('reminder'), TURN_REMINDER_MS);
    return () => clearInterval(timer);
  }, [turnKey]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    []
  );
}
